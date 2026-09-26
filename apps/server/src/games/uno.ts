import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";

/**
 * UNO — the classic shedding game, built for 2–10 players.
 * Match the top card by color or value; wilds let you pick the color; specials
 * skip, reverse, and force draws. First empty hand wins and scores the table.
 * Hands are private: the view only ever exposes the caller's own cards.
 */

type CardColor = "red" | "yellow" | "green" | "blue" | "wild";
type ActiveColor = Exclude<CardColor, "wild">;

interface UnoCard {
  id: string;
  color: CardColor;
  value: string; // "0".."9" | "skip" | "reverse" | "draw2" | "wild" | "wild4"
}

export interface UnoState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  hands: Record<string, UnoCard[]>;
  deck: UnoCard[];
  discard: UnoCard[];
  activeColor: ActiveColor;
  order: string[]; // turn order (userIds)
  turnIndex: number;
  direction: 1 | -1;
  drawnPending: string | null; // player who just drew a playable card: play it or pass
  mustCallUno: Record<string, boolean>;
  turnStartedAt: number;
  winnerId: string | null;
  finalScores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("play"),
    cardId: z.string().min(1).max(40),
    color: z.enum(["red", "yellow", "green", "blue"]).optional(),
  }),
  z.object({ action: z.literal("draw") }),
  z.object({ action: z.literal("pass") }),
  z.object({ action: z.literal("call_uno") }),
  z.object({ action: z.literal("catch"), targetId: z.string().min(1).max(64) }),
]);

const COLORS: ActiveColor[] = ["red", "yellow", "green", "blue"];

function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let n = 0;
  for (const color of COLORS) {
    for (const value of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      deck.push({ id: `c${n++}`, color, value });
      if (value !== "0") deck.push({ id: `c${n++}`, color, value });
    }
    for (const value of ["skip", "reverse", "draw2"]) {
      deck.push({ id: `c${n++}`, color, value });
      deck.push({ id: `c${n++}`, color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c${n++}`, color: "wild", value: "wild" });
    deck.push({ id: `c${n++}`, color: "wild", value: "wild4" });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

function topCard(s: UnoState): UnoCard | null {
  return s.discard[s.discard.length - 1] ?? null;
}

function isPlayable(card: UnoCard, s: UnoState): boolean {
  if (card.color === "wild") return true;
  if (card.color === s.activeColor) return true;
  const top = topCard(s);
  return !!top && card.value === top.value && top.color !== "wild";
}

function drawCards(s: UnoState, userId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    if (!s.deck.length) {
      // Reshuffle the discard pile (keeping the top card) back into the deck.
      const top = s.discard.pop();
      s.deck = s.discard.splice(0, s.discard.length);
      if (top) s.discard.push(top);
      for (let j = s.deck.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [s.deck[j], s.deck[k]] = [s.deck[k]!, s.deck[j]!];
      }
      if (!s.deck.length) return; // everyone is hoarding cards — nothing to draw
    }
    const card = s.deck.pop();
    if (card) (s.hands[userId] ??= []).push(card);
  }
}

function playerAt(s: UnoState, steps: number): string | null {
  const n = s.order.length;
  if (!n) return null;
  const idx = (((s.turnIndex + s.direction * steps) % n) + n) % n;
  return s.order[idx] ?? null;
}

/** Advance the turn `steps` seats in the current direction. */
function advanceTurn(s: UnoState, steps: number, now: number): void {
  s.drawnPending = null;
  const n = s.order.length;
  s.turnIndex = (((s.turnIndex + s.direction * steps) % n) + n) % n;
  s.turnStartedAt = now;
}

function cardPoints(card: UnoCard): number {
  if (card.color === "wild") return 50;
  if (card.value === "skip" || card.value === "reverse" || card.value === "draw2") return 20;
  return Number(card.value) || 0;
}

export const unoGame: GameModule<UnoState> = {
  id: "uno",
  name: "UNO",
  tagline: "Match the color, dump your hand",
  description:
    "The card game that ruins friendships, now in your room. Match the top card by color or value, slap down wilds to steer the game, and shout UNO before you're caught out. First player with an empty hand wins.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 15,
  style: "cards",
  actionSchema,

  createState({ playerIds }): UnoState {
    const deck = buildDeck();
    const hands: Record<string, UnoCard[]> = {};
    for (const id of playerIds) {
      hands[id] = [];
      for (let i = 0; i < 7; i++) {
        const card = deck.pop();
        if (card) hands[id]!.push(card);
      }
    }
    // Flip the first non-wild card to start the discard pile.
    let start = deck.pop()!;
    while (start.color === "wild") {
      deck.unshift(start);
      start = deck.pop()!;
    }
    const order = [...playerIds];
    return {
      status: "active",
      round: 1,
      hands,
      deck,
      discard: [start],
      activeColor: start.color as ActiveColor,
      order,
      turnIndex: 0,
      direction: 1,
      drawnPending: null,
      mustCallUno: {},
      turnStartedAt: Date.now(),
      winnerId: null,
      finalScores: {},
    };
  },

  onAction(state, ctx): GameEffect<UnoState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s: UnoState = structuredClone(state);
    const act = parsed.data;
    const me = ctx.userId;
    const messages: string[] = [];
    const hand = s.hands[me];
    if (!hand) throw new Error("You are not in this game");
    const isMyTurn = s.order[s.turnIndex] === me;

    if (act.action === "call_uno") {
      if (hand.length !== 1) throw new Error("You can only call UNO with exactly one card left");
      s.mustCallUno[me] = false;
      return { state: s, systemMessages: ["UNO!"] };
    }

    if (act.action === "catch") {
      // Any player may catch anyone (else) who is down to one card without having
      // called UNO. Works across turns — just like shouting it across the table.
      if (act.targetId === me) throw new Error("You can't catch yourself");
      if (!s.hands[act.targetId]) throw new Error("That player is not in the game");
      if (s.mustCallUno[act.targetId] !== true || (s.hands[act.targetId]?.length ?? 0) !== 1) {
        throw new Error("They already called UNO — nothing to catch");
      }
      s.mustCallUno[act.targetId] = false;
      drawCards(s, act.targetId, 2);
      messages.push("Caught! A player forgot to call UNO and drew 2 cards.");
      return { state: s, systemMessages: messages };
    }

    if (act.action === "play") {
      if (!isMyTurn) throw new Error("It's not your turn");
      const idx = hand.findIndex((c) => c.id === act.cardId);
      if (idx === -1) throw new Error("You don't have that card");
      const card = hand[idx]!;
      if (!isPlayable(card, s)) throw new Error("That card doesn't match the color or value");
      if (card.color === "wild" && !act.color) throw new Error("Pick a color for your wild card");
      hand.splice(idx, 1);
      s.discard.push(card);
      s.activeColor = card.color === "wild" ? (act.color as ActiveColor) : (card.color as ActiveColor);
      s.drawnPending = null;

      if (hand.length === 0) {
        // Win: winner scores every card left in the other hands.
        let total = 0;
        for (const [uid, otherHand] of Object.entries(s.hands)) {
          for (const c of otherHand) total += cardPoints(c);
          if (uid !== me) s.finalScores[uid] = 0;
        }
        s.finalScores[me] = total;
        s.winnerId = me;
        s.status = "completed";
        messages.push("The last card hits the table — game over!");
        return { state: s, systemMessages: messages, completed: true };
      }
      if (hand.length === 1) s.mustCallUno[me] = true;

      if (card.value === "skip") {
        messages.push("Skip! The next player loses a turn.");
        advanceTurn(s, 2, ctx.now);
      } else if (card.value === "reverse") {
        if (s.order.length === 2) {
          messages.push("Reverse — in a duel it plays like a Skip.");
          advanceTurn(s, 2, ctx.now);
        } else {
          s.direction = (s.direction * -1) as 1 | -1;
          messages.push("Direction reversed!");
          advanceTurn(s, 1, ctx.now);
        }
      } else if (card.value === "draw2") {
        const victim = playerAt(s, 1);
        if (victim) drawCards(s, victim, 2);
        messages.push("Draw two! The next player picks up and sits out.");
        advanceTurn(s, 2, ctx.now);
      } else if (card.value === "wild4") {
        const victim = playerAt(s, 1);
        if (victim) drawCards(s, victim, 4);
        messages.push("Wild Draw Four! Brutal.");
        advanceTurn(s, 2, ctx.now);
      } else {
        advanceTurn(s, 1, ctx.now);
      }
      return { state: s, systemMessages: messages };
    }

    if (act.action === "draw") {
      if (!isMyTurn) throw new Error("It's not your turn");
      if (s.drawnPending) throw new Error("You already drew — play it or pass");
      drawCards(s, me, 1);
      const drawn = hand[hand.length - 1];
      if (drawn && isPlayable(drawn, s)) {
        s.drawnPending = me;
        // Playable: the player chooses to play it or pass.
      } else {
        messages.push("No luck with the draw — turn passes.");
        advanceTurn(s, 1, ctx.now);
      }
      return { state: s, systemMessages: messages };
    }

    // pass — only right after drawing
    if (!isMyTurn) throw new Error("It's not your turn");
    if (s.drawnPending !== me) throw new Error("You can only pass right after drawing");
    messages.push("Kept the card — turn passes.");
    advanceTurn(s, 1, ctx.now);
    return { state: s, systemMessages: messages };
  },

  tick(state, ctx) {
    if (state.status !== "active") return null;
    if (ctx.now - state.turnStartedAt < 90_000) return null;
    const s: UnoState = structuredClone(state);
    const messages: string[] = ["Time! The turn was resolved automatically."];
    const cur = s.order[s.turnIndex]!;
    if (s.drawnPending) {
      advanceTurn(s, 1, ctx.now);
    } else {
      drawCards(s, cur, 1);
      const drawn = s.hands[cur]?.[s.hands[cur]!.length - 1];
      if (drawn && isPlayable(drawn, s)) {
        s.drawnPending = cur; // one grace period to come back and play it
      } else {
        advanceTurn(s, 1, ctx.now);
      }
    }
    return { state: s, systemMessages: messages };
  },

  onPlayerLeft(state, userId) {
    const s: UnoState = structuredClone(state);
    const idx = s.order.indexOf(userId);
    if (idx === -1) return { state: s };
    s.order.splice(idx, 1);
    delete s.hands[userId];
    delete s.mustCallUno[userId];
    if (s.drawnPending === userId) s.drawnPending = null;
    if (idx < s.turnIndex) s.turnIndex = Math.max(0, s.turnIndex - 1);
    if (s.order.length < 2) {
      // One player left: they win with whatever points are on the table.
      const last = s.order[0];
      let total = 0;
      s.finalScores = {};
      if (last) {
        for (const [uid, hand] of Object.entries(s.hands)) {
          for (const c of hand) total += cardPoints(c);
          if (uid !== last) s.finalScores[uid] = 0;
        }
        s.finalScores[last] = total;
        s.winnerId = last;
      }
      s.status = "completed";
      return { state: s, completed: true, systemMessages: ["Everyone else left — last player standing wins."] };
    }
    s.turnIndex = s.turnIndex % s.order.length;
    return { state: s };
  },

  scoreSummary(state) {
    return Object.entries(state.finalScores).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId, extras) {
    const nameOf = (id: string) => extras.members.find((m) => m.userId === id)?.displayName ?? "Someone";
    const top = topCard(state);
    const turnId = state.order[state.turnIndex % Math.max(1, state.order.length)] ?? null;
    return {
      kind: "uno",
      players: state.order.map((id) => ({
        id,
        name: nameOf(id),
        count: state.hands[id]?.length ?? 0,
      })),
      myHand: userId ? (state.hands[userId] ?? []).map((c) => ({ id: c.id, color: c.color, value: c.value })) : [],
      topCard: top ? { color: top.color, value: top.value } : null,
      activeColor: state.activeColor,
      direction: state.direction,
      turnId,
      isMyTurn: !!userId && turnId === userId,
      canPassDraw: state.drawnPending === userId,
      mustCallUno: !!userId && state.mustCallUno[userId] === true,
      deckCount: state.deck.length,
      winnerId: state.winnerId,
    };
  },
};
