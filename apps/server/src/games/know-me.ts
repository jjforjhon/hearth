import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * HOW WELL DO YOU KNOW ME?
 * The subject answers a question privately; everyone else predicts their answer;
 * reveal + discussion. Predictors score on hits; the subject scores per reader
 * who failed to predict them (mystery bonus) — no, simpler: subject scores per
 * correct predictor (being knowable is a compliment).
 */

interface CurrentRound {
  subjectId: string;
  question: string;
  questionId: string;
  subjectAnswer: string | null; // private until reveal
  options: string[]; // 4 answer options the subject assigned/chose
  guesses: Record<string, string>; // predictor userId -> option text
  revealed: boolean;
  deadline: number;
}

export interface KnowMeState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: CurrentRound | null;
  usedQuestionIds: string[];
  usedSubjects: string[];
  scores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit_answer"), answer: z.string().min(1).max(120) }),
  z.object({ action: z.literal("guess"), answer: z.string().min(1).max(120) }),
  z.object({ action: z.literal("next") }),
]);

export const knowMeGame: GameModule<KnowMeState> = {
  id: "know_me",
  name: "How Well Do You Know Me?",
  tagline: "Predict each other's answers",
  description:
    "One player answers a question in secret. Everyone else guesses what they said. The reveal is where friendships are tested — kindly.",
  minPlayers: 3,
  maxPlayers: 10,
  approxMinutes: 12,
  style: "conversation",
  actionSchema,

  createState({ playerIds }): KnowMeState {
    const s: KnowMeState = {
      status: "active",
      round: 0,
      totalRounds: Math.max(3, playerIds.length * 2),
      current: null,
      usedQuestionIds: [],
      usedSubjects: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    };
    return startRound(s, playerIds, Date.now());
  },

  onAction(state, ctx): GameEffect<KnowMeState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (!s.current) {
      startRound(s, ctx.playerIds, ctx.now);
      if (act.action === "submit_answer" && s.current!.subjectId === ctx.userId) {
        s.current!.subjectAnswer = act.answer;
      }
      return { state: s };
    }

    const cur = s.current;
    if (act.action === "submit_answer") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (ctx.userId !== cur.subjectId) throw new Error("Only the subject answers");
      if (cur.subjectAnswer) throw new Error("Answer already locked in");
      cur.subjectAnswer = act.answer;
      const predictors = Object.keys(s.scores).filter((id) => id !== cur.subjectId);
      if (predictors.every((p) => cur.guesses[p])) return revealRound(s);
      return { state: s };
    }

    if (act.action === "guess") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (ctx.userId === cur.subjectId) throw new Error("The subject doesn't guess");
      if (cur.guesses[ctx.userId]) throw new Error("You already guessed");
      if (!cur.subjectAnswer) throw new Error("Waiting for the subject's answer");
      cur.guesses[ctx.userId] = act.answer;
      const predictors = Object.keys(s.scores).filter((id) => id !== cur.subjectId);
      if (predictors.every((p) => cur.guesses[p])) return revealRound(s);
      return { state: s };
    }

    if (!cur.revealed) throw new Error("Finish the round first");
    if (s.round >= s.totalRounds) {
      s.status = "completed";
      return { state: s, completed: true };
    }
    return { state: startRound(s, ctx.playerIds, ctx.now) };
  },

  tick(state, ctx) {
    if (!state.current || state.current.revealed) return null;
    if (ctx.now < state.current.deadline) return null;
    const s = structuredClone(state);
    const cur = s.current!;
    if (!cur.subjectAnswer) cur.subjectAnswer = "…kept it a mystery";
    return revealRound(s);
  },

  scoreSummary(state) {
    return Object.entries(state.scores).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId) {
    const nameOf = (id: string) => extrasName(id);
    const cur = state.current
      ? {
          subjectId: state.current.subjectId,
          subjectName: nameOf(state.current.subjectId),
          question: state.current.question,
          isSubject: userId === state.current.subjectId,
          myAnswer: userId === state.current.subjectId ? state.current.subjectAnswer : null,
          myGuess: userId ? state.current.guesses[userId] ?? null : null,
          revealed: state.current.revealed,
          realAnswer: state.current.revealed ? state.current.subjectAnswer : null,
          guesses: state.current.revealed
            ? Object.entries(state.current.guesses).map(([id, guess]) => ({
                userId: id,
                name: nameOf(id),
                guess,
                hit: guess === state.current!.subjectAnswer,
              }))
            : null,
          guessCount: Object.keys(state.current.guesses).length,
          deadline: state.current.deadline,
        }
      : null;
    return {
      kind: "know_me",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      scores: Object.fromEntries(Object.entries(state.scores).map(([id, v]) => [id, { score: v, name: nameOf(id) }])),
    };
  },
};

// Names are resolved client-side from the members list; ids travel over the wire.
function extrasName(_id: string): string {
  return "";
}

function startRound(s: KnowMeState, playerIds: string[], now: number): KnowMeState {
  const candidates = playerIds.filter((p) => p in s.scores);
  if (!candidates.length) throw new Error("Not enough players");
  const eligible = candidates.filter((p) => !s.usedSubjects.includes(p));
  const subjectId = (eligible.length ? eligible : candidates)[0]!;
  if (!s.usedSubjects.includes(subjectId)) s.usedSubjects.push(subjectId);
  let q = sampleGenericContent("prompt", "know_me", 1, s.usedQuestionIds)[0];
  if (!q?.body) {
    s.usedQuestionIds = [];
    q = sampleGenericContent("prompt", "know_me", 1)[0];
  }
  if (!q?.body) throw new Error("Question pool is empty");
  s.usedQuestionIds.push(q.id);
  s.round += 1;
  s.current = {
    subjectId,
    question: q.body,
    questionId: q.id,
    subjectAnswer: null,
    options: [],
    guesses: {},
    revealed: false,
    deadline: now + 90_000,
  };
  return s;
}

function revealRound(s: KnowMeState): GameEffect<KnowMeState> {
  const cur = s.current!;
  cur.revealed = true;
  let hits = 0;
  for (const [uid, guess] of Object.entries(cur.guesses)) {
    if (cur.subjectAnswer && guess.trim().toLowerCase() === cur.subjectAnswer.trim().toLowerCase()) {
      s.scores[uid] = (s.scores[uid] ?? 0) + 1;
      hits += 1;
    }
  }
  s.scores[cur.subjectId] = (s.scores[cur.subjectId] ?? 0) + hits;
  return { state: s };
}
