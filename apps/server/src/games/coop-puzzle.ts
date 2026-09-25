import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * COOPERATIVE PUZZLE — one brain, many heads.
 * The room shares one puzzle at a time. Anyone can guess; wrong group guesses
 * burn shared lives; hints are bought with the shared score. The team wins when
 * all puzzles are solved before lives run out. Communication is the mechanic.
 */

interface CurrentPuzzle {
  puzzleId: string;
  type: string;
  body: string;
  solution: string;
  hintsTaken: number;
  hints: string[];
  wrongGuesses: number;
  solvedBy: string | null;
}

export interface CoopPuzzleState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  totalRounds: number;
  current: CurrentPuzzle | null;
  usedPuzzleIds: string[];
  teamScore: number;
  lives: number;
  hintsBought: number;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("guess"), text: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("hint") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("next") }),
]);

export const coopPuzzleGame: GameModule<CoopPuzzleState> = {
  id: "coop_puzzle",
  name: "Co-op Puzzle",
  tagline: "One puzzle, one team",
  description:
    "The room works every puzzle together. Hints cost team points, wrong guesses cost lives, and victory only counts for everyone. Talk it out.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 12,
  style: "cooperative",
  actionSchema,

  createState(): CoopPuzzleState {
    return {
      status: "active",
      round: 0,
      totalRounds: 5,
      current: null,
      usedPuzzleIds: [],
      teamScore: 0,
      lives: 3,
      hintsBought: 0,
    };
  },

  onAction(state, ctx): GameEffect<CoopPuzzleState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (!s.current || s.current.solvedBy) {
      // No puzzle yet, or the previous one was just solved — advance.
      if (s.round >= s.totalRounds || s.lives <= 0) {
        s.status = "completed";
        return { state: s, completed: true };
      }
      const solvedJustNow = !!s.current?.solvedBy;
      startPuzzle(s);
      return {
        state: s,
        systemMessages: solvedJustNow ? [`Puzzle ${s.round}: ${s.current!.body}`] : [`Puzzle ${s.round}: ${s.current!.body}`],
      };
    }

    if (act.action === "guess") {
      const cur = s.current!;
      if (cur.solvedBy) throw new Error("Already solved");
      if (normalize(act.text) === normalize(cur.solution)) {
        const base = 10 - cur.hintsTaken * 3;
        const gained = Math.max(2, base);
        s.teamScore += gained;
        cur.solvedBy = ctx.userId;
        s.round += 1;
        const messages = [
          `Solved by ${ctx.userId === cur.solvedBy ? "the team" : "the team"}! +${gained} points`,
          cur.hintsTaken > 0 ? `(hints used: ${cur.hintsTaken})` : "No hints — flawless!",
        ].filter(Boolean) as string[];
        if (s.round >= s.totalRounds) {
          s.status = "completed";
          return { state: s, completed: true, systemMessages: [...messages, "All puzzles cleared!"] };
        }
        if (s.lives <= 0) {
          s.status = "completed";
          return { state: s, completed: true, systemMessages: messages };
        }
        return { state: s, systemMessages: messages };
      }
      cur.wrongGuesses += 1;
      s.lives -= 1;
      if (s.lives <= 0) {
        s.status = "completed";
        return { state: s, completed: true, systemMessages: ["Out of lives! The puzzles won this time."] };
      }
      return { state: s, systemMessages: [`Nope — ${s.lives} ${s.lives === 1 ? "life" : "lives"} left`] };
    }

    if (act.action === "hint") {
      const cur = s.current!;
      if (cur.solvedBy) throw new Error("Already solved");
      if (cur.hintsTaken >= cur.hints.length) throw new Error("No hints left for this one");
      const hint = cur.hints[cur.hintsTaken]!;
      cur.hintsTaken += 1;
      s.hintsBought += 1;
      return { state: s, systemMessages: [`Hint: ${hint}`] };
    }

    // skip
    const cur = s.current!;
    if (cur.solvedBy) throw new Error("Already solved");
    s.lives -= 1;
    s.round += 1;
    if (s.lives <= 0 || s.round >= s.totalRounds) {
      s.status = "completed";
      return { state: s, completed: true, systemMessages: ["The puzzle run has ended."] };
    }
    startPuzzle(s);
    return { state: s, systemMessages: [`Skipped. Next puzzle: ${s.current!.body}`] };
  },

  scoreSummary() {
    // Cooperative game: the team score lives in the view, not per-player ranks.
    return [];
  },

  view(state, userId) {
    const cur = state.current
      ? {
          type: state.current.type,
          body: state.current.body,
          hintsRevealed: state.current.hints.slice(0, state.current.hintsTaken),
          hintsLeft: state.current.hints.length - state.current.hintsTaken,
          wrongGuesses: state.current.wrongGuesses,
          solved: !!state.current.solvedBy,
          solution: state.current.solvedBy ? state.current.solution : null,
        }
      : null;
    return {
      kind: "coop_puzzle",
      round: state.round,
      totalRounds: state.totalRounds,
      current: cur,
      teamScore: state.teamScore,
      lives: state.lives,
      myUserId: userId,
    };
  },
};

function startPuzzle(s: CoopPuzzleState): void {
  let pool = sampleGenericContent("prompt", "coop_puzzle", 1, s.usedPuzzleIds);
  if (!pool[0]?.body) {
    s.usedPuzzleIds = [];
    pool = sampleGenericContent("prompt", "coop_puzzle", 1);
  }
  const raw = pool[0];
  if (!raw?.body) throw new Error("Puzzle pool is empty");
  const puzzle = JSON.parse(raw.body) as { type: string; body: string; solution: string; hints: string[] };
  s.usedPuzzleIds.push(raw.id);
  s.round += 1;
  s.current = {
    puzzleId: raw.id,
    type: puzzle.type,
    body: puzzle.body,
    solution: puzzle.solution,
    hintsTaken: 0,
    hints: puzzle.hints ?? [],
    wrongGuesses: 0,
    solvedBy: null,
  };
}

function normalize(t: string): string {
  return t.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
