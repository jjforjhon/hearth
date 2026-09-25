import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * THIS OR THAT — fast simultaneous voting.
 * Two options per round; everyone picks privately; reveal shows who chose what,
 * matches with you, unusual picks and group splits. Points for majority matches.
 */

interface CurrentRound {
  pairId: string;
  optionA: string;
  optionB: string;
  votes: Record<string, "a" | "b">;
  revealed: boolean;
  deadline: number;
}

export interface ThisOrThatState extends BaseGameState {
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

export const thisOrThatGame: GameModule<ThisOrThatState> = {
  id: "this_or_that",
  name: "This or That",
  tagline: "Fast choices, instant reveals",
  description:
    "Two options, ten seconds of deliberation, and a reveal that shows who matches whom. The fastest way to discover the group's tiny divides.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 8,
  style: "conversation",
  actionSchema,

  createState({ playerIds, settings }): ThisOrThatState {
    const s: ThisOrThatState = {
      status: "active",
      round: 0,
      totalRounds: Math.max(5, Math.min(25, settings.truthFalse.rounds * 2)),
      current: null,
      usedPairIds: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    };
    // First dilemma is live immediately.
    return startRound(s, Date.now());
  },

  onAction(state, ctx): GameEffect<ThisOrThatState> {
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
      if (act.action === "vote") {
        // Vote raced the round start; accept it immediately.
        s.current!.votes[ctx.userId] = act.choice;
      }
      return { state: s };
    }

    const cur = s.current;
    if (act.action === "vote") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (cur.votes[ctx.userId]) throw new Error("You already voted");
      cur.votes[ctx.userId] = act.choice;
      const everyone = Object.keys(s.scores).length;
      if (Object.keys(cur.votes).length >= everyone) return revealRound(s);
      return { state: s };
    }

    // next
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
    const s = structuredClone(state);
    // Absent voters abstain; reveal with whoever showed up.
    return revealRound(s);
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
      kind: "this_or_that",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      scores: state.scores,
    };
  },
};

function startRound(s: ThisOrThatState, now: number, secondsPerRound = 20): ThisOrThatState {
  const pool = sampleGenericContent("choice_pair", "this_or_that", 1, s.usedPairIds);
  const pair = pool[0]?.options;
  if (!pair || pair.length < 2) {
    // Pool exhausted — recycle used pairs rather than stalling.
    const any = sampleGenericContent("choice_pair", "this_or_that", 1)[0];
    s.usedPairIds = any?.id ? [] : s.usedPairIds;
    if (!any?.options) throw new Error("Content pool is empty");
    pairPush(s, any.id, any.options[0]!, any.options[1]!, now);
    return s;
  }
  pairPush(s, pool[0]!.id, pair[0]!, pair[1]!, now);
  return s;
}

function pairPush(s: ThisOrThatState, id: string, a: string, b: string, now: number): void {
  s.usedPairIds.push(id);
  s.round += 1;
  s.current = { pairId: id, optionA: a, optionB: b, votes: {}, revealed: false, deadline: now + 20_000 };
}

function revealRound(s: ThisOrThatState): GameEffect<ThisOrThatState> {
  const cur = s.current!;
  cur.revealed = true;
  const counts = { a: 0, b: 0 };
  for (const v of Object.values(cur.votes)) counts[v] += 1;
  const majority = counts.a === counts.b ? null : counts.a > counts.b ? "a" : "b";
  if (majority) {
    for (const [uid, v] of Object.entries(cur.votes)) {
      if (v === majority) s.scores[uid] = (s.scores[uid] ?? 0) + 1;
    }
  } else {
    // Tie: everyone who voted gets a solidarity point.
    for (const uid of Object.keys(cur.votes)) s.scores[uid] = (s.scores[uid] ?? 0) + 1;
  }
  return { state: s };
}
