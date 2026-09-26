import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";

/**
 * LUDO — the classic race home, 2–4 players.
 * Roll a six to leave the yard, race your four tokens around the 52-cell track,
 * send rivals back to base by landing on them, and bring every token home.
 * Safe cells (starts and stars) protect tokens from capture.
 * Positions are public — no hidden information in this game.
 */

type Color = "red" | "green" | "yellow" | "blue";

const COLORS: Color[] = ["red", "green", "yellow", "blue"];
const START_CELL: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const HOME = 56; // finished
const TRACK_END = 50; // last main-track step before a color's home column
const BASE = -1;

export interface LudoState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  order: string[]; // userIds, seat order
  seats: Color[]; // seat i of `order` plays color seats[i] — kept index-aligned
  tokens: Record<Color, number[]>; // 4 tokens each: BASE | 0..50 track | 51..55 home column | HOME
  dice: number | null;
  diceRolled: boolean;
  turnIndex: number;
  sixStreak: number;
  turnStartedAt: number;
  rolledAt: number | null;
  captures: Record<string, number>; // userId -> tokens sent home
  finishedOrder: string[]; // userIds in finish order
  finalScores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("roll") }),
  z.object({ action: z.literal("move"), token: z.number().int().min(0).max(3) }),
]);

function seatColors(playerCount: number): Color[] {
  if (playerCount === 2) return ["red", "yellow"]; // opposite corners
  return COLORS.slice(0, playerCount);
}

function tokensHome(tokens: number[]): number {
  return tokens.filter((p) => p === HOME).length;
}

function legalMoves(state: LudoState, color: Color, dice: number): number[] {
  const res: number[] = [];
  state.tokens[color]?.forEach((pos, i) => {
    if (pos === HOME) return;
    if (pos === BASE) {
      if (dice === 6) res.push(i);
      return;
    }
    if (pos + dice <= HOME) res.push(i);
  });
  return res;
}

function advanceTurn(s: LudoState, now: number): void {
  s.dice = null;
  s.diceRolled = false;
  s.sixStreak = 0;
  s.rolledAt = null;
  s.turnIndex = (s.turnIndex + 1) % Math.max(1, s.order.length);
  s.turnStartedAt = now;
}

function computeScores(s: LudoState): void {
  const scores: Record<string, number> = {};
  s.order.forEach((uid, i) => {
    const color = s.seats[i];
    if (!color || !s.tokens[color]) return;
    scores[uid] = tokensHome(s.tokens[color]!) * 10 + (s.captures[uid] ?? 0) * 5;
  });
  s.finalScores = scores;
}

function applyMove(s: LudoState, color: Color, tokenIdx: number, dice: number, messages: string[]): boolean {
  const tokens = s.tokens[color]!;
  const pos = tokens[tokenIdx]!;
  let captured = 0;
  if (pos === BASE) {
    tokens[tokenIdx] = 0; // onto the start cell — always safe
  } else {
    const dest = pos + dice;
    tokens[tokenIdx] = dest;
    if (dest <= TRACK_END) {
      const cell = (START_CELL[color] + dest) % 52;
      if (!SAFE_CELLS.has(cell)) {
        // Scan every color ever seated (left players' tokens stay as roadkill).
        for (const other of Object.keys(s.tokens) as Color[]) {
          if (other === color) continue;
          const otherTokens = s.tokens[other]!;
          for (let i = 0; i < otherTokens.length; i++) {
            const p = otherTokens[i]!;
            if (p === BASE || p === HOME || p > TRACK_END) continue;
            if ((START_CELL[other] + p) % 52 === cell) {
              otherTokens[i] = BASE;
              captured += 1;
            }
          }
        }
      }
    }
  }
  const capturer = s.order[s.turnIndex]!;
  if (captured > 0) {
    s.captures[capturer] = (s.captures[capturer] ?? 0) + captured;
    messages.push(`Landed on someone — ${captured} token${captured > 1 ? "s" : ""} sent back to base!`);
  }
  return tokensHome(tokens) === 4;
}

function finishGame(s: LudoState, winnerId: string, messages: string[]): GameEffect<LudoState> {
  s.finishedOrder.unshift(winnerId);
  computeScores(s);
  s.status = "completed";
  messages.push("All four tokens home — victory lap!");
  return { state: s, systemMessages: messages, completed: true };
}

/** Roll the dice for `color` and apply the outcome; returns true if a move is now required. */
function rollDice(s: LudoState, color: Color, now: number, messages: string[]): boolean {
  const die = 1 + Math.floor(Math.random() * 6);
  s.dice = die;
  s.diceRolled = true;
  s.rolledAt = now;
  s.sixStreak = die === 6 ? s.sixStreak + 1 : 0;
  const moves = legalMoves(s, color, die);
  if (!moves.length) {
    messages.push(`Rolled ${die} — no legal move.`);
    advanceTurn(s, now);
    return false;
  }
  messages.push(`Rolled ${die}.`);
  return true;
}

export const ludoGame: GameModule<LudoState> = {
  id: "ludo",
  name: "Ludo",
  tagline: "Race your tokens home",
  description:
    "The board game every household argues over. Roll a six to launch, dodge the capture zones, and bring all four tokens home before your rivals do. Safe squares, brutal landings, exact finishes.",
  minPlayers: 2,
  maxPlayers: 4,
  approxMinutes: 20,
  style: "board",
  actionSchema,

  createState({ playerIds }): LudoState {
    const colors = seatColors(playerIds.length);
    const tokens = {} as Record<Color, number[]>;
    for (const c of colors) tokens[c] = [BASE, BASE, BASE, BASE];
    const captures: Record<string, number> = {};
    for (const id of playerIds) captures[id] = 0;
    return {
      status: "active",
      round: 1,
      order: [...playerIds],
      seats: [...colors],
      tokens,
      dice: null,
      diceRolled: false,
      turnIndex: 0,
      sixStreak: 0,
      turnStartedAt: Date.now(),
      rolledAt: null,
      captures,
      finishedOrder: [],
      finalScores: {},
    };
  },

  onAction(state, ctx): GameEffect<LudoState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s: LudoState = structuredClone(state);
    const act = parsed.data;
    const messages: string[] = [];
    const seat = s.order.indexOf(ctx.userId);
    if (seat === -1) throw new Error("You are not in this game");
    if (s.order[s.turnIndex] !== ctx.userId) throw new Error("It's not your turn");
    const color = s.seats[seat]!;

    if (act.action === "roll") {
      if (s.diceRolled) throw new Error("You already rolled — move a token");
      if (s.sixStreak >= 3) {
        messages.push("Three sixes in a row — turn forfeited!");
        advanceTurn(s, ctx.now);
        return { state: s, systemMessages: messages };
      }
      rollDice(s, color, ctx.now, messages);
      return { state: s, systemMessages: messages };
    }

    // move
    if (!s.diceRolled || s.dice === null) throw new Error("Roll the dice first");
    const moves = legalMoves(s, color, s.dice);
    if (!moves.includes(act.token)) throw new Error("That token can't move with this roll");
    const won = applyMove(s, color, act.token, s.dice, messages);
    if (won) return finishGame(s, ctx.userId, messages);
    if (s.dice === 6) {
      if (s.sixStreak >= 3) {
        messages.push("Three sixes in a row — turn forfeited!");
        advanceTurn(s, ctx.now);
      } else {
        // Roll again.
        s.dice = null;
        s.diceRolled = false;
        s.rolledAt = null;
        messages.push("A six! Roll again.");
      }
    } else {
      advanceTurn(s, ctx.now);
    }
    return { state: s, systemMessages: messages };
  },

  tick(state, ctx) {
    if (state.status !== "active") return null;
    const s: LudoState = structuredClone(state);
    const messages: string[] = [];
    const color = s.seats[s.turnIndex]!;
    if (!s.diceRolled) {
      // Idle with an unrolled dice: auto-roll once, then give a grace window to move.
      if (ctx.now - s.turnStartedAt < 45_000) return null;
      if (!rollDice(s, color, ctx.now, messages)) {
        messages.unshift("Auto-rolled for an idle player.");
        return { state: s, systemMessages: messages };
      }
      messages.unshift("Auto-rolled for an idle player.");
      return { state: s, systemMessages: messages };
    }
    // Rolled but idle too long: take the first legal move automatically.
    if (ctx.now - (s.rolledAt ?? s.turnStartedAt) < 30_000) return null;
    const moves = legalMoves(s, color, s.dice!);
    if (!moves.length) {
      advanceTurn(s, ctx.now);
      return { state: s, systemMessages: messages };
    }
    // Prefer releasing from base, else advance the leading token.
    const baseIdx = moves.find((i) => s.tokens[color]![i] === BASE);
    const tokenIdx = baseIdx ?? moves[moves.length - 1]!;
    const wasSix = s.dice === 6;
    const won = applyMove(s, color, tokenIdx, s.dice!, messages);
    messages.unshift("An idle player was auto-moved.");
    if (won) return finishGame(s, s.order[s.turnIndex]!, messages);
    if (wasSix && s.sixStreak < 3) {
      s.dice = null;
      s.diceRolled = false;
      s.rolledAt = null;
      return { state: s, systemMessages: messages };
    }
    if (wasSix && s.sixStreak >= 3) messages.push("Three sixes in a row — turn forfeited!");
    advanceTurn(s, ctx.now);
    return { state: s, systemMessages: messages };
  },

  onPlayerLeft(state, userId) {
    const s: LudoState = structuredClone(state);
    const idx = s.order.indexOf(userId);
    if (idx === -1) return { state: s };
    // Their tokens stay on the board as roadkill — capturable, unmovable.
    s.order.splice(idx, 1);
    s.seats.splice(idx, 1); // seats stay index-aligned with order
    if (idx < s.turnIndex) s.turnIndex = Math.max(0, s.turnIndex - 1);
    s.dice = null;
    s.diceRolled = false;
    s.rolledAt = null;
    if (s.order.length < 2) {
      computeScores(s);
      s.status = "completed";
      return { state: s, completed: true, systemMessages: ["Not enough players left — game over."] };
    }
    s.turnIndex = s.turnIndex % s.order.length;
    return { state: s };
  },

  scoreSummary(state) {
    if (Object.keys(state.finalScores).length) {
      return Object.entries(state.finalScores).map(([userId, score]) => ({ userId, score, displayName: "" }));
    }
    return state.order.map((userId, i) => {
      const color = state.seats[i];
      const home = color && state.tokens[color] ? tokensHome(state.tokens[color]!) : 0;
      return { userId, score: home * 10 + (state.captures[userId] ?? 0) * 5, displayName: "" };
    });
  },

  view(state, userId, extras) {
    const nameOf = (id: string) => extras.members.find((m) => m.userId === id)?.displayName ?? "Someone";
    const turnId = state.order[state.turnIndex % Math.max(1, state.order.length)] ?? null;
    const mySeat = userId ? state.order.indexOf(userId) : -1;
    const myColor = mySeat >= 0 ? state.seats[mySeat] ?? null : null;
    return {
      kind: "ludo",
      players: state.order.map((id, i) => {
        const color = state.seats[i]!;
        return {
          id,
          name: nameOf(id),
          color,
          tokensHome: tokensHome(state.tokens[color] ?? []),
          captures: state.captures[id] ?? 0,
        };
      }),
      // Full board is public in Ludo; positions are per-token step counts.
      tokens: Object.fromEntries(
        Object.entries(state.tokens).map(([c, positions]) => [c, positions]),
      ),
      dice: state.dice,
      diceRolled: state.diceRolled,
      turnId,
      isMyTurn: !!userId && turnId === userId,
      myColor,
      legalTokens:
        !!userId && turnId === userId && state.diceRolled && state.dice !== null && myColor
          ? legalMoves(state, myColor, state.dice)
          : [],
      sixStreak: state.sixStreak,
      finishedOrder: state.finishedOrder,
      winnerId: state.finishedOrder[0] ?? null,
    };
  },
};
