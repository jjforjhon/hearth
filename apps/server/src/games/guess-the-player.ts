import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * GUESS THE PLAYER — social deduction lite.
 * Players answer the same prompt anonymously; answers are shuffled and shown
 * one at a time; everyone guesses who wrote each one. Correct guesses score;
 * being hard to read scores more.
 */

interface SubmissionRound {
  prompt: string;
  promptId: string;
  submissions: Record<string, string>; // userId -> answer (server-side only)
  shuffled: Array<{ token: string; text: string; authorId: string }>; // token = stable per-item key
  guessPhase: "submitting" | "guessing" | "revealed";
  guesses: Record<string, Record<string, string>>; // guesserId -> token -> authorId
  deadline: number;
}

export interface GuessThePlayerState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: SubmissionRound | null;
  usedPromptIds: string[];
  scores: Record<string, number>;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), text: z.string().trim().min(2).max(140) }),
  z.object({ action: z.literal("guess"), token: z.string().min(1).max(40), authorId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("next") }),
]);

export const guessThePlayerGame: GameModule<GuessThePlayerState> = {
  id: "guess_the_player",
  name: "Guess the Player",
  tagline: "Who said that?",
  description:
    "Everyone answers the same prompt in secret. The answers come back shuffled — can you tell who wrote what? Reading the room has never been more competitive.",
  minPlayers: 3,
  maxPlayers: 10,
  approxMinutes: 12,
  style: "conversation",
  actionSchema,

  createState({ playerIds }): GuessThePlayerState {
    const s: GuessThePlayerState = {
      status: "active",
      round: 0,
      totalRounds: Math.max(3, Math.min(8, playerIds.length)),
      current: null,
      usedPromptIds: [],
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    };
    return startRound(s, playerIds, Date.now());
  },

  onAction(state, ctx): GameEffect<GuessThePlayerState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (!s.current) {
      startRound(s, ctx.playerIds, ctx.now);
      if (act.action === "submit" && s.current!.submissions[ctx.userId] === undefined) {
        s.current!.submissions[ctx.userId] = act.text;
      }
      return { state: s };
    }

    const cur = s.current;
    if (act.action === "submit") {
      if (cur.guessPhase !== "submitting") throw new Error("Submissions are closed");
      if (cur.submissions[ctx.userId] !== undefined) throw new Error("Already submitted");
      cur.submissions[ctx.userId] = act.text;
      const expected = Object.keys(s.scores).length;
      if (Object.keys(cur.submissions).length >= expected) enterGuessing(cur);
      return { state: s };
    }

    if (act.action === "guess") {
      if (cur.guessPhase !== "guessing") throw new Error("Not in the guessing phase");
      if (!cur.shuffled.some((i) => i.token === act.token)) throw new Error("Unknown item");
      if (cur.guesses[ctx.userId]?.[act.token]) throw new Error("Already guessed on this one");
      if (!cur.shuffled.some((i) => i.token === act.token && i.authorId === act.authorId)) {
        throw new Error("That player is not an option");
      }
      (cur.guesses[ctx.userId] ??= {})[act.token] = act.authorId;
      const expectedPerPlayer = cur.shuffled.filter((i) => i.authorId !== ctx.userId).length;
      const mine = Object.keys(cur.guesses[ctx.userId]!).length;
      if (mine >= expectedPerPlayer) {
        // Everyone done? Check all.
        const players = Object.keys(s.scores).filter((p) => cur.submissions[p] !== undefined);
        const allDone = players.every((p) => {
          const need = cur.shuffled.filter((i) => i.authorId !== p).length;
          return Object.keys(cur.guesses[p] ?? {}).length >= need;
        });
        if (allDone) return revealRound(s);
      }
      return { state: s };
    }

    // next
    if (cur.guessPhase !== "revealed") throw new Error("Finish the round first");
    if (s.round >= s.totalRounds) {
      s.status = "completed";
      return { state: s, completed: true };
    }
    return { state: startRound(s, ctx.playerIds, ctx.now) };
  },

  tick(state, ctx) {
    if (!state.current || state.current.guessPhase === "revealed") return null;
    if (ctx.now >= state.current.deadline) {
      const s = structuredClone(state);
      const cur = s.current!;
      if (cur.guessPhase === "submitting") {
        // Fill missing submissions from the platform statement pool so guessing can start.
        const missing = Object.keys(s.scores).filter((p) => cur.submissions[p] === undefined);
        const fillers = sampleGenericContent("statement", "guess_the_player", missing.length);
        missing.forEach((p, i) => {
          cur.submissions[p] = fillers[i]?.body ?? "I have no secrets and no imagination.";
        });
        enterGuessing(cur);
      } else {
        return revealRound(s);
      }
      return { state: s };
    }
    return null;
  },

  scoreSummary(state) {
    return Object.entries(state.scores).map(([userId, score]) => ({ userId, score, displayName: "" }));
  },

  view(state, userId) {
    const nameOf = (id: string) => extrasName(id);
    const cur = state.current
      ? {
          prompt: state.current.prompt,
          phase: state.current.guessPhase,
          mySubmission: userId ? state.current.submissions[userId] ?? null : null,
          submittedCount: Object.keys(state.current.submissions).length,
          items:
            state.current.guessPhase === "submitting"
              ? null
              : state.current.shuffled
                  .filter((i) => i.authorId !== userId)
                  .map((i) => ({
                    token: i.token,
                    text: i.text,
                    myGuess: state.current!.guesses[userId ?? ""]?.[i.token] ?? null,
                  })),
          revealed:
            state.current.guessPhase === "revealed"
              ? state.current.shuffled.map((i) => ({
                  token: i.token,
                  text: i.text,
                  authorId: i.authorId,
                  authorName: nameOf(i.authorId),
                  guessedBy: Object.entries(state.current!.guesses)
                    .filter(([, byToken]) => byToken[i.token] === i.authorId)
                    .map(([guesser]) => guesser),
                }))
              : null,
          deadline: state.current.deadline,
        }
      : null;
    return {
      kind: "guess_the_player",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      scores: state.scores,
    };
  },
};

function extrasName(_id: string): string {
  return "";
}

function startRound(s: GuessThePlayerState, playerIds: string[], now: number): GuessThePlayerState {
  let pool = sampleGenericContent("prompt", "guess_the_player_prompt", 1, s.usedPromptIds);
  if (!pool[0]?.body) {
    s.usedPromptIds = [];
    pool = sampleGenericContent("prompt", "guess_the_player_prompt", 1);
  }
  const promptItem = pool[0];
  if (!promptItem?.body) throw new Error("Prompt pool is empty");
  s.usedPromptIds.push(promptItem.id);
  s.round += 1;
  s.current = {
    prompt: promptItem.body,
    promptId: promptItem.id,
    submissions: {},
    shuffled: [],
    guessPhase: "submitting",
    guesses: {},
    deadline: now + 60_000,
  };
  return s;
}

function enterGuessing(cur: NonNullable<GuessThePlayerState["current"]>): void {
  const entries = Object.entries(cur.submissions);
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  cur.shuffled = shuffled.map(([authorId, text], i) => ({ token: `t${i}`, text, authorId }));
  cur.guessPhase = "guessing";
}

function revealRound(s: GuessThePlayerState): GameEffect<GuessThePlayerState> {
  const cur = s.current!;
  cur.guessPhase = "revealed";
  // Score: guessers +1 per correct guess; authors +1 per player they fooled.
  for (const [guesser, byToken] of Object.entries(cur.guesses)) {
    for (const [token, authorId] of Object.entries(byToken)) {
      const item = cur.shuffled.find((i) => i.token === token);
      if (item && item.authorId === authorId) {
        s.scores[guesser] = (s.scores[guesser] ?? 0) + 1;
      }
    }
  }
  for (const item of cur.shuffled) {
    const fooled = Object.entries(cur.guesses).filter(([, byToken]) => byToken[item.token] && byToken[item.token] !== item.authorId);
    // +1 per incorrect guess attributed to their text (capped at 3)
    s.scores[item.authorId] = (s.scores[item.authorId] ?? 0) + Math.min(3, fooled.length);
  }
  return { state: s };
}
