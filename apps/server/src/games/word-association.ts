import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * WORD ASSOCIATION — reflex + imagination.
 * A word is drawn; everyone races to type the first association. Rules in one
 * line: first answer scores 3, unique answers score 2, duplicates score 1.
 * Rounds are short and loud.
 */

interface CurrentRound {
  word: string;
  wordId: string;
  answers: Record<string, string>; // userId -> normalized answer
  answerTimes: Record<string, number>;
  revealed: boolean;
  deadline: number;
}

export interface WordAssociationState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: CurrentRound | null;
  usedWordIds: string[];
  scores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), word: z.string().min(1).max(40) }),
  z.object({ action: z.literal("next") }),
]);

export const wordAssociationGame: GameModule<WordAssociationState> = {
  id: "word_association",
  name: "Word Association",
  tagline: "First word that pops into your head",
  description:
    "One word on the table, everyone racing. First answer takes 3 points, unique answers take 2, matches take 1. Simple, fast, surprisingly competitive.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 6,
  style: "quiz",
  actionSchema,

  createState({ playerIds }): WordAssociationState {
    const s: WordAssociationState = {
      status: "active",
      round: 0,
      totalRounds: 8,
      current: null,
      usedWordIds: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    };
    return startRound(s, Date.now());
  },

  onAction(state, ctx): GameEffect<WordAssociationState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (!s.current) {
      startRound(s, ctx.now);
      if (act.action === "answer") acceptAnswer(s, ctx.userId, act.word, ctx.now);
      return { state: s };
    }

    const cur = s.current;
    if (act.action === "answer") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (cur.answers[ctx.userId]) throw new Error("You already answered");
      acceptAnswer(s, ctx.userId, act.word, ctx.now);
      const expected = Object.keys(s.scores).length;
      if (Object.keys(cur.answers).length >= expected) return revealRound(s);
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
          word: state.current.word,
          myAnswer: userId ? state.current.answers[userId] ?? null : null,
          answeredCount: Object.keys(state.current.answers).length,
          revealed: state.current.revealed,
          answers: state.current.revealed
            ? Object.entries(state.current.answerTimes)
                .sort(([, a], [, b]) => a - b)
                .map(([id, t]) => ({
                  userId: id,
                  word: state.current!.answers[id] ?? "",
                  ms: t - (state.current!.deadline - 20_000),
                  duplicate: Object.values(state.current!.answers).filter(
                    (w) => w === state.current!.answers[id],
                  ).length > 1,
                }))
            : null,
          deadline: state.current.deadline,
        }
      : null;
    return {
      kind: "word_association",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      scores: state.scores,
    };
  },
};

function startRound(s: WordAssociationState, now: number): WordAssociationState {
  let pool = sampleGenericContent("word", "association", 1, s.usedWordIds);
  if (!pool[0]?.body) {
    s.usedWordIds = [];
    pool = sampleGenericContent("word", "association", 1);
  }
  const w = pool[0];
  if (!w?.body) throw new Error("Word pool is empty");
  s.usedWordIds.push(w.id);
  s.round += 1;
  s.current = {
    word: w.body,
    wordId: w.id,
    answers: {},
    answerTimes: {},
    revealed: false,
    deadline: now + 15_000,
  };
  return s;
}

function acceptAnswer(s: WordAssociationState, userId: string, rawWord: string, now: number): void {
  const cur = s.current!;
  cur.answers[userId] = rawWord.trim().toLowerCase();
  cur.answerTimes[userId] = now;
}

function revealRound(s: WordAssociationState): GameEffect<WordAssociationState> {
  const cur = s.current!;
  cur.revealed = true;
  const counts: Record<string, number> = {};
  for (const w of Object.values(cur.answers)) counts[w] = (counts[w] ?? 0) + 1;
  const firstByTime = Object.entries(cur.answerTimes).sort(([, a], [, b]) => a - b);
  if (firstByTime[0]) {
    s.scores[firstByTime[0][0]] = (s.scores[firstByTime[0][0]] ?? 0) + 3;
  }
  for (const [uid, w] of Object.entries(cur.answers)) {
    const pts = counts[w] === 1 ? 2 : 1;
    s.scores[uid] = (s.scores[uid] ?? 0) + pts;
  }
  return { state: s };
}
