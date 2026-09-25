import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * STORY TOGETHER — collaborative fiction.
 * A server-drawn opener sets the scene; players add a sentence each in turn.
 * Submissions are length-capped, sanitized at the edges (plain text), and the
 * whole story stays readable after the game ends via history + game:state replay.
 */

export interface StoryTogetherState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  opener: string;
  lines: Array<{ userId: string; text: string; at: number }>;
  turnIndex: number;
  order: string[];
  usedOpenerIds: string[];
  deadline: number;
  title: string;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_line"), text: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("finish_story") }),
]);

const LINES_PER_PLAYER = 3;

export const storyTogetherGame: GameModule<StoryTogetherState> = {
  id: "story_together",
  name: "Story Together",
  tagline: "One sentence each, one story forever",
  description:
    "The server sets the scene, then everyone adds one sentence per turn. When the last line lands, the whole story is saved to the room to reread together.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 10,
  style: "creative",
  actionSchema,

  createState({ playerIds, settings }): StoryTogetherState {
    const opener = sampleGenericContent("prompt", "story", 1)[0]?.body ??
      "The train arrived at a station that wasn't on any map, and only one person seemed surprised.";
    return {
      status: "active",
      round: 1,
      opener,
      lines: [],
      turnIndex: 0,
      order: [...playerIds],
      usedOpenerIds: [],
      deadline: Date.now() + 120_000,
      title: "",
    };
  },

  onAction(state, ctx): GameEffect<StoryTogetherState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s = structuredClone(state);
    const act = parsed.data;

    if (act.action === "add_line") {
      const currentId = s.order[s.turnIndex % s.order.length]!;
      if (ctx.userId !== currentId) throw new Error("It's not your line");
      if (s.lines.length >= s.order.length * LINES_PER_PLAYER) {
        throw new Error("The story is complete — finish it to save");
      }
      s.lines.push({ userId: ctx.userId, text: act.text, at: ctx.now });
      s.turnIndex = (s.turnIndex + 1) % s.order.length;
      s.round = s.lines.length + 1;
      s.deadline = ctx.now + 120_000;
      if (s.lines.length >= s.order.length * LINES_PER_PLAYER) {
        s.status = "completed";
        return { state: s, completed: true, systemMessages: ["The story is complete! Scroll back and enjoy."] };
      }
      return { state: s };
    }

    // finish_story — host or any player after at least 3 lines can end early.
    if (s.lines.length < 3) throw new Error("Add at least three lines before ending the story");
    s.status = "completed";
    return { state: s, completed: true };
  },

  tick(state, ctx) {
    if (ctx.now < state.deadline) return null;
    // Auto-skip a stalled turn with a narrator nudge.
    const s = structuredClone(state);
    s.turnIndex = (s.turnIndex + 1) % s.order.length;
    s.deadline = ctx.now + 120_000;
    return { state: s, systemMessages: ["Time passed — the plot thickens on the next author."] };
  },

  onPlayerLeft(state, userId) {
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== userId);
    if (s.order.length < 2) {
      s.status = "completed";
      return { state: s, completed: true };
    }
    if (s.turnIndex >= s.order.length) s.turnIndex = 0;
    return { state: s };
  },

  scoreSummary() {
    return [];
  },

  view(state, userId) {
    const nameOf = (id: string) => extrasName(id);
    return {
      kind: "story_together",
      opener: state.opener,
      lines: state.lines.map((l) => ({ ...l, authorName: nameOf(l.userId) })),
      currentAuthorId: state.order[state.turnIndex % Math.max(1, state.order.length)] ?? null,
      isMyTurn: userId === (state.order[state.turnIndex % Math.max(1, state.order.length)] ?? null),
      status: state.status,
    };
  },
};

function extrasName(_id: string): string {
  return "";
}
