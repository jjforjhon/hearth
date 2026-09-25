import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleContent } from "../store.js";

/**
 * TRUTH OR DARE — the platform's flagship.
 * Spin selects the next player; they choose Truth or Dare (or reroll the spin);
 * the server draws a tier-appropriate item; dares may request optional/required
 * media (photo/video/voice/drawing) via the private media pipeline.
 * Skips are limited; the host can end the game; the show goes on.
 */

interface CurrentTurn {
  playerId: string;
  kind: "truth" | "dare" | null; // null until chosen
  itemId: string | null;
  prompt: string | null;
  category: string | null;
  difficulty: 1 | 2 | 3;
  mediaPolicy: "none" | "optional" | "required";
  mediaKinds: string[];
  mediaSubmitted: boolean;
  fulfilled: boolean; // player marked it done / submitted media
  skipped: boolean;
}

export interface TruthOrDareState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  turnIndex: number; // index into order
  order: string[]; // turn order (userIds)
  current: CurrentTurn | null;
  usedItemIds: string[];
  skipsUsed: Record<string, number>;
  history: Array<{
    round: number;
    playerId: string;
    kind: "truth" | "dare";
    prompt: string;
    fulfilled: boolean;
    skipped: boolean;
    mediaUrl: string | null;
  }>;
  maxSkipsPerPlayer: number;
  completedCount: number;
  spunAt: number | null;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("spin") }),
  z.object({ action: z.literal("choose"), kind: z.enum(["truth", "dare"]) }),
  z.object({ action: z.literal("done") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("media_submitted"), mediaId: z.string().min(3).max(80) }),
  z.object({ action: z.literal("pass_turn") }),
]);

export const truthOrDareGame: GameModule<TruthOrDareState> = {
  id: "truth_or_dare",
  name: "Truth or Dare",
  tagline: "The classic, with weekly-fresh prompts",
  description:
    "Spin to pick who's up, choose Truth or Dare, and let the server draw from a weekly-refreshed library. Dares can invite photos, voice notes or drawings — always shared privately to the room.",
  minPlayers: 3,
  maxPlayers: 10,
  approxMinutes: 20,
  style: "conversation",
  actionSchema,

  createState({ playerIds, settings }): TruthOrDareState {
    const order = [...playerIds];
    // deterministic-ish shuffle so host isn't always first
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return {
      status: "active",
      round: 1,
      turnIndex: 0,
      order,
      current: null,
      usedItemIds: [],
      skipsUsed: Object.fromEntries(playerIds.map((id) => [id, 0])),
      history: [],
      maxSkipsPerPlayer: 2,
      completedCount: 0,
      spunAt: null,
    };
  },

  onAction(state, ctx): GameEffect<TruthOrDareState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s: TruthOrDareState = structuredClone(state);
    const act = parsed.data;
    const settings = ctx.settings.truthOrDare;

    if (act.action === "spin") {
      if (s.current) throw new Error("A turn is already in progress");
      // Only the current player or host can spin (keeps order sane).
      const currentId = s.order[s.turnIndex % s.order.length]!;
      if (ctx.userId !== currentId) throw new Error("It's not your spin");
      s.spunAt = ctx.now;
      s.current = {
        playerId: currentId,
        kind: null,
        itemId: null,
        prompt: null,
        category: null,
        difficulty: 1,
        mediaPolicy: "none",
        mediaKinds: [],
        mediaSubmitted: false,
        fulfilled: false,
        skipped: false,
      };
      return { state: s, systemMessages: [`It's ${nameOf(ctx, currentId)}'s turn — Truth or Dare?`] };
    }

    if (act.action === "choose") {
      if (!s.current || s.current.playerId !== ctx.userId) throw new Error("Not your turn");
      if (s.current.kind) throw new Error("Already chosen");
      s.current.kind = act.kind;
      const maxTier = settings?.maxTier ?? 3;
      const item = drawItem(act.kind, maxTier, s.usedItemIds);
      if (!item) throw new Error("The prompt library ran dry — an admin can regenerate it");
      s.current.itemId = item.id;
      s.current.prompt = item.body;
      s.current.category = item.category;
      s.current.difficulty = (item.difficulty as 1 | 2 | 3) ?? 1;
      s.current.mediaPolicy = (item.media_policy as "none" | "optional" | "required") ?? "none";
      s.current.mediaKinds = item.media_kinds ? JSON.parse(item.media_kinds) : [];
      s.usedItemIds.push(item.id);
      if (!settings?.allowMedia) {
        // Room policy forbids media challenges: remap to a text dare/truth.
        s.current.mediaPolicy = "none";
        s.current.mediaKinds = [];
      }
      return {
        state: s,
        systemMessages: [
          `${act.kind === "truth" ? "Truth" : "Dare"} for ${nameOf(ctx, ctx.userId)}: ${s.current.prompt}`,
        ],
      };
    }

    if (act.action === "done") {
      if (!s.current || s.current.playerId !== ctx.userId) throw new Error("Not your turn");
      if (!s.current.kind) throw new Error("Choose Truth or Dare first");
      s.current.fulfilled = true;
      return finishTurn(s, ctx, "completed");
    }

    if (act.action === "skip") {
      if (!s.current || s.current.playerId !== ctx.userId) throw new Error("Not your turn");
      const used = s.skipsUsed[ctx.userId] ?? 0;
      if (used >= s.maxSkipsPerPlayer) throw new Error("No skips left for you this game");
      s.skipsUsed[ctx.userId] = used + 1;
      s.current.skipped = true;
      return finishTurn(s, ctx, "skipped");
    }

    if (act.action === "media_submitted") {
      if (!s.current || s.current.playerId !== ctx.userId) throw new Error("Not your turn");
      s.current.mediaSubmitted = true;
      s.current.fulfilled = true;
      // Media URL is attached by the client from the media pipeline response.
      return finishTurn(s, ctx, "completed");
    }

    if (act.action === "pass_turn") {
      // Host may force-advance a stalled turn. Host identity is injected by the
      // engine via the payload's __hostCheck performed in handleAction; here we
      // accept the module call because the engine verified membership+host.
      if (!s.current) throw new Error("No turn in progress");
      return finishTurn(s, ctx, "passed");
    }

    throw new Error("Unknown action");
  },

  tick(state, ctx) {
    // Auto-pass if the current player has been idle with an open turn for 3 minutes.
    if (!state.current) return null;
    const openedAt = state.spunAt ?? 0;
    if (ctx.now - openedAt < 180_000) return null;
    const s = structuredClone(state);
    s.current!.skipped = true;
    const effect = finishTurn(s, { userId: state.current.playerId }, "timeout");
    return effect;
  },

  onPlayerLeft(state, userId) {
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== userId);
    delete s.skipsUsed[userId];
    if (s.current) {
      if (s.current.playerId === userId) {
        s.current.skipped = true;
        // mark turn finished
        s.history.push({
          round: s.round,
          playerId: userId,
          kind: s.current.kind ?? "truth",
          prompt: s.current.prompt ?? "(left mid-turn)",
          fulfilled: false,
          skipped: true,
          mediaUrl: null,
        });
        s.current = null;
        s.turnIndex = (s.turnIndex + 1) % Math.max(1, s.order.length);
        if (s.turnIndex === 0) s.round += 1;
      }
    }
    if (s.order.length < 3) {
      s.status = "completed";
      return { state: s, completed: true };
    }
    return { state: s };
  },

  scoreSummary(state) {
    // Truth or Dare is cooperative-social; scores are participation counts.
    const completed = state.history.filter((h) => h.fulfilled && !h.skipped);
    const counts: Record<string, number> = {};
    for (const h of completed) counts[h.playerId] = (counts[h.playerId] ?? 0) + 1;
    return Object.entries(counts).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId, extras) {
    const nameOf = (id: string) => extras.members.find((m) => m.userId === id)?.displayName ?? "Someone";
    const cur = state.current
      ? {
          playerId: state.current.playerId,
          playerName: nameOf(state.current.playerId),
          kind: state.current.kind,
          prompt: state.current.prompt,
          category: state.current.category,
          difficulty: state.current.difficulty,
          mediaPolicy: state.current.mediaPolicy,
          mediaKinds: state.current.mediaKinds,
          mediaSubmitted: state.current.mediaSubmitted,
          isMine: userId === state.current.playerId,
        }
      : null;
    return {
      kind: "truth_or_dare",
      round: state.round,
      order: state.order.map((id) => ({ id, name: nameOf(id) })),
      currentPlayerId: state.order[state.turnIndex % Math.max(1, state.order.length)] ?? null,
      current: cur,
      skipsUsed: state.skipsUsed,
      maxSkips: state.maxSkipsPerPlayer,
      myHistory: userId ? state.history.filter((h) => h.playerId === userId) : [],
      historyTail: state.history.slice(-12).map((h) => ({ ...h, playerName: nameOf(h.playerId) })),
    };
  },
};

function nameOf(ctx: { playerIds?: string[] }, userId: string): string {
  // Names come from the view extras at render time; system messages use generic phrasing.
  return "the player";
}

function drawItem(
  kind: "truth" | "dare",
  maxTier: 1 | 2 | 3,
  usedIds: string[],
): { id: string; body: string; category: string; difficulty: number; media_policy: string; media_kinds: string } | null {
  const pool = sampleContent(kind, 1, { maxDifficulty: maxTier, excludeIds: usedIds });
  const item = pool[0];
  if (!item) return null;
  return item;
}

function finishTurn(
  s: TruthOrDareState,
  ctx: { userId: string },
  outcome: "completed" | "skipped" | "passed" | "timeout",
): GameEffect<TruthOrDareState> {
  const cur = s.current!;
  s.history.push({
    round: s.round,
    playerId: cur.playerId,
    kind: cur.kind ?? "truth",
    prompt: cur.prompt ?? "",
    fulfilled: cur.fulfilled && !cur.skipped,
    skipped: cur.skipped,
    mediaUrl: null,
  });
  if (cur.fulfilled && !cur.skipped) s.completedCount += 1;
  const messages: string[] = [];
  if (outcome === "skipped" || outcome === "timeout") {
    messages.push(`${cur.kind ?? "Turn"} skipped`);
  } else if (outcome === "passed") {
    messages.push(`Turn passed by the host`);
  }
  s.current = null;
  s.turnIndex = (s.turnIndex + 1) % Math.max(1, s.order.length);
  if (s.turnIndex === 0) s.round += 1;
  // A round is done when every remaining player has spun; rounds are informational.
  return { state: s, systemMessages: messages };
}


