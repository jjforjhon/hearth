import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * WOULD YOU RATHER — the dilemma engine.
 * Harder pairs than This or That, longer think time, richer reveal: the group
 * split, who matched whom, and the lone-wolf pick. Built to start arguments
 * (the friendly kind).
 */

interface CurrentRound {
  pairId: string;
  optionA: string;
  optionB: string;
  votes: Record<string, "a" | "b">;
  revealed: boolean;
  deadline: number;
}

export interface WouldYouRatherState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: CurrentRound | null;
  usedPairIds: string[];
  scores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("vote"), choice: z.enum(["a", "b"]) }),
  z.object({ action: z.literal("next") }),
]);

export const wouldYouRatherGame: GameModule<WouldYouRatherState> = {
  id: "would_you_rather",
  name: "Would You Rather",
  tagline: "Impossible choices, loud debates",
  description:
    "Dilemmas with no right answer. Everyone locks in a choice, then the reveal — and the arguing — begins. Lone wolves earn bonus points for bravery.",
  minPlayers: 3,
  maxPlayers: 10,
  approxMinutes: 12,
  style: "conversation",
  actionSchema,

  createState({ playerIds }): WouldYouRatherState {
    const s: WouldYouRatherState = {
      status: "active",
      round: 0,
      totalRounds: 10,
      current: null,
      usedPairIds: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    };
    return startRound(s, Date.now());
  },

  onAction(state, ctx): GameEffect<WouldYouRatherState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (!s.current) {
      if (s.round >= s.totalRounds) {
        s.status = "completed";
        return { state: s, completed: true };
      }
      startRound(s, ctx.now);
      if (act.action === "vote") s.current!.votes[ctx.userId] = act.choice;
      return { state: s };
    }

    const cur = s.current;
    if (act.action === "vote") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (cur.votes[ctx.userId]) throw new Error("You already voted");
      cur.votes[ctx.userId] = act.choice;
      const expected = Object.keys(s.scores).length;
      if (Object.keys(cur.votes).length >= expected) return revealRound(s);
      return { state: s };
    }

    if (!cur.revealed) throw new Error("Finish the round first");
    if (s.round >= s.totalRounds) {
      s.status = "completed";
      return { state: s, completed: true };
    }
    return { state: startRound(s, ctx.now) };
  },

  tick(state, ctx) {
    if (!state.current || state.current.revealed) return null;
    if (ctx.now < state.current.deadline) return null;
    return revealRound(structuredClone(state));
  },

  scoreSummary(state) {
    return Object.entries(state.scores).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId) {
    const cur = state.current
      ? {
          optionA: state.current.optionA,
          optionB: state.current.optionB,
          myVote: userId ? state.current.votes[userId] ?? null : null,
          revealed: state.current.revealed,
          votesA: state.current.revealed
            ? Object.entries(state.current.votes).filter(([, v]) => v === "a").map(([id]) => id)
            : null,
          votesB: state.current.revealed
            ? Object.entries(state.current.votes).filter(([, v]) => v === "b").map(([id]) => id)
            : null,
          deadline: state.current.deadline,
        }
      : null;
    return {
      kind: "would_you_rather",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      scores: state.scores,
    };
  },
};

function startRound(s: WouldYouRatherState, now: number): WouldYouRatherState {
  let pool = sampleGenericContent("choice_pair", "would_you_rather", 1, s.usedPairIds);
  if (!pool[0]?.options) {
    s.usedPairIds = []; // recycle when exhausted
    pool = sampleGenericContent("choice_pair", "would_you_rather", 1);
  }
  const item = pool[0];
  if (!item?.options || item.options.length < 2) throw new Error("Content pool is empty");
  s.usedPairIds.push(item.id);
  s.round += 1;
  s.current = {
    pairId: item.id,
    optionA: item.options[0]!,
    optionB: item.options[1]!,
    votes: {},
    revealed: false,
    deadline: now + 30_000,
  };
  return s;
}

function revealRound(s: WouldYouRatherState): GameEffect<WouldYouRatherState> {
  const cur = s.current!;
  cur.revealed = true;
  const counts = { a: 0, b: 0 };
  for (const v of Object.values(cur.votes)) counts[v] += 1;
  const minority = counts.a === counts.b ? null : counts.a < counts.b ? "a" : "b";
  if (minority) {
    // Bravery bonus: minority pickers earn 2.
    for (const [uid, v] of Object.entries(cur.votes)) {
      if (v === minority) s.scores[uid] = (s.scores[uid] ?? 0) + 2;
    }
  }
  return { state: s };
}
