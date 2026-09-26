import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState, RoomSettings } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * TRUTH / FALSE
 * Each round, one player is the "subject". They receive a statement (about
 * themselves in-person style: preference/experience claims) and write a short
 * personal "truth" answer OR read a platform statement and decide how to present
 * it. Simpler, robust design used here: every round shows a statement; the
 * subject answers with TRUE or FALSE about themselves; everyone else bets on
 * what they think the subject will say. Reveal, discussion, points.
 */

interface RoundState {
  subjectId: string;
  prompt: string;
  votes: Record<string, string>; // userId -> "true" | "false"
  subjectVote: string | null;
  revealed: boolean;
  deadline: number;
}

export interface TruthFalseState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: RoundState | null;
  usedPromptIds: string[];
  usedSubjects: string[];
  scores: Record<string, number>;
  subjectsWhoAnsweredThisRound: boolean;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("vote"), choice: z.enum(["true", "false"]) }),
  z.object({ action: z.literal("subject_answer"), choice: z.enum(["true", "false"]) }),
  z.object({ action: z.literal("next_round") }),
]);

function pickPrompt(usedIds: string[]): { id: string; body: string } | null {
  const items = sampleGenericContent("prompt", "truth_false", 5, usedIds);
  const first = items[0];
  if (!first || !first.body) return null;
  return { id: first.id, body: first.body };
}

export const truthFalseGame: GameModule<TruthFalseState> = {
  id: "truth_false",
  name: "True or False",
  tagline: "Guess the facts about each other",
  description:
    "Each round one player answers a personal statement with true or false — everyone else bets on what they'll say. Matches score points and spark the best arguments.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 10,
  style: "conversation",
  actionSchema,

  createState({ playerIds, settings }): TruthFalseState {
    const totalRounds = Math.max(3, Math.min(25, settings.truthFalse.rounds));
    const s: TruthFalseState = {
      status: "active",
      round: 0,
      totalRounds,
      current: null,
      usedPromptIds: [],
      usedSubjects: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
      subjectsWhoAnsweredThisRound: false,
    };
    // First round begins immediately so the game opens with a live prompt.
    return startRound(s, playerIds, Date.now(), settings.truthFalse.secondsPerRound);
  },

  onAction(state, ctx): GameEffect<TruthFalseState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const act = parsed.data;
    const s: TruthFalseState = structuredClone(state);

    if (!s.current) {
      // Start first/next round; any player may trigger by voting early.
      return { state: startRound(s, ctx.playerIds, ctx.now) };
    }

    const cur = s.current;

    if (act.action === "vote") {
      if (cur.revealed) throw new Error("Round already revealed");
      if (act.choice === undefined) throw new Error("Invalid vote");
      if (cur.votes[ctx.userId] !== undefined) throw new Error("You already voted");
      cur.votes[ctx.userId] = act.choice;
      const nonSubject = ctx.playerIds.filter((p) => p !== cur.subjectId);
      const allVoted = nonSubject.every((p) => cur.votes[p] !== undefined);
      if (allVoted && cur.subjectVote) return revealRound(s);
      return { state: s };
    }

    if (act.action === "subject_answer") {
      if (ctx.userId !== cur.subjectId) throw new Error("Only the subject answers this");
      if (cur.revealed) throw new Error("Round already revealed");
      cur.subjectVote = act.choice;
      const nonSubject = ctx.playerIds.filter((p) => p !== cur.subjectId);
      const allVoted = nonSubject.every((p) => cur.votes[p] !== undefined);
      if (allVoted) return revealRound(s);
      return { state: s };
    }

    // next_round
    if (!cur.revealed) throw new Error("Finish the current round first");
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
    // Auto-submit absent votes as the majority-avoiding default so rounds never stall.
    for (const p of ctx.playerIds) {
      if (p === cur.subjectId) {
        if (!cur.subjectVote) cur.subjectVote = "true";
      } else if (cur.votes[p] === undefined) {
        cur.votes[p] = Math.random() < 0.5 ? "true" : "false";
      }
    }
    return revealRound(s);
  },

  onPlayerLeft(state, userId) {
    const s = structuredClone(state);
    if (s.current && !s.current.revealed) {
      delete s.current.votes[userId];
    }
    delete s.scores[userId];
    return { state: s };
  },

  scoreSummary(state) {
    return Object.entries(state.scores).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId, extras) {
    const nameOf = (id: string) => extras.members.find((m) => m.userId === id)?.displayName ?? "Someone";
    const cur = state.current
      ? {
          subjectId: state.current.subjectId,
          subjectName: nameOf(state.current.subjectId),
          prompt: state.current.prompt,
          myVote: userId ? state.current.votes[userId] ?? null : null,
          subjectVoteRevealed: state.current.revealed ? state.current.subjectVote : null,
          revealed: state.current.revealed,
          votesCount: Object.keys(state.current.votes).length,
          deadline: state.current.deadline,
          voteBreakdown: state.current.revealed ? state.current.votes : null,
          scores: Object.fromEntries(
            Object.entries(state.scores).map(([id, v]) => [id, { score: v, name: nameOf(id) }]),
          ),
        }
      : null;
    return {
      kind: "truth_false",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      isSubject: !!state.current && userId === state.current.subjectId,
    };
  },
};

function startRound(s: TruthFalseState, playerIds: string[], now: number, secondsPerRound = 30): TruthFalseState {
  // Rotate subjects; skip players who left.
  const candidates = playerIds.filter((p) => p in s.scores);
  if (!candidates.length) throw new Error("Not enough players");
  const eligible = candidates.filter((p) => !s.usedSubjects.includes(p));
  const subjectId = (eligible.length ? eligible : candidates)[0]!;
  s.usedSubjects = s.usedSubjects.includes(subjectId) ? s.usedSubjects : [...s.usedSubjects, subjectId];
  const prompt = pickPrompt(s.usedPromptIds) ?? {
    id: "fallback-1",
    body: "I once finished an entire series in one weekend.",
  };
  s.usedPromptIds.push(prompt.id);
  s.round += 1;
  s.current = {
    subjectId,
    prompt: prompt.body,
    votes: {},
    subjectVote: null,
    revealed: false,
    deadline: now + secondsPerRound * 1000,
  };
  s.subjectsWhoAnsweredThisRound = false;
  return s;
}

function revealRound(s: TruthFalseState): GameEffect<TruthFalseState> {
  const cur = s.current!;
  cur.revealed = true;
  const correct = cur.votes[cur.subjectId] ?? null; // players matching the subject's answer
  if (cur.subjectVote && correct) {
    // Bets matching the subject get a point; the subject scores per correct reader.
    for (const [uid, vote] of Object.entries(cur.votes)) {
      if (vote === cur.subjectVote) s.scores[uid] = (s.scores[uid] ?? 0) + 1;
    }
    const matches = Object.values(cur.votes).filter((v) => v === cur.subjectVote).length;
    s.scores[cur.subjectId] = (s.scores[cur.subjectId] ?? 0) + matches;
  }
  return { state: s };
}
