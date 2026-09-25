import { z } from "zod";
import type { GameModule, GameEffect, BaseGameState } from "@hearth/shared";
import { sampleGenericContent } from "../store.js";

/**
 * DRAW TOGETHER — realtime shared canvas.
 * Strokes are validated, throttled server-side, stored in state (bounded), and
 * broadcast as incremental events for low latency. New/rejoining players receive
 * the full stroke list to reconstruct the canvas. Undo removes a player's own
 * last stroke only. Template mode seeds outline strokes into the canvas.
 */

export interface Stroke {
  id: string;
  userId: string;
  color: string;
  width: number;
  points: number[]; // flat [x,y,x,y...] in 0-1000 normalized space
  mode: "pen" | "eraser";
  seq: number;
}

export interface DrawTogetherState extends BaseGameState {
  status: "active" | "completed";
  round: 1;
  mode: "creative" | "template";
  templateId: string | null;
  templateStrokes: Stroke[]; // reference outline (not user-erasable)
  strokes: Stroke[]; // player strokes, append-only; undo removes by id
  seq: number;
  deadline: number | null;
  prompt: string | null;
}

const strokeSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(1).max(48),
  points: z.array(z.number().min(0).max(1000)).min(4).max(2400),
  mode: z.enum(["pen", "eraser"]),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stroke"), stroke: strokeSchema }),
  z.object({ action: z.literal("undo") }),
  z.object({ action: z.literal("clear_mine") }),
  z.object({ action: z.literal("finish") }),
]);

const MAX_STROKES = 4000; // bounds state size; creative sessions rarely exceed this
const MAX_POINTS_PER_USER_PER_TICK = 6000; // anti-flood

export const drawTogetherGame: GameModule<DrawTogetherState> = {
  id: "draw_together",
  name: "Draw Together",
  tagline: "One canvas, everyone draws",
  description:
    "A realtime shared canvas for up to ten artists. Start from a blank page or complete a template outline together — pen, colors, eraser, undo, and cursors included.",
  minPlayers: 2,
  maxPlayers: 10,
  approxMinutes: 15,
  style: "creative",
  actionSchema,

  createState({ settings }): DrawTogetherState {
    const mode = settings.drawTogether.mode;
    const templateId = mode === "template" ? (settings.drawTogether.templateId ?? "cat") : null;
    const templateStrokes = templateId ? loadTemplateStrokes(templateId) : [];
    return {
      status: "active",
      round: 1,
      mode,
      templateId,
      templateStrokes,
      strokes: [],
      seq: 0,
      deadline: Date.now() + settings.drawTogether.roundSeconds * 1000,
      prompt: null,
    };
  },

  onAction(state, ctx): GameEffect<DrawTogetherState> {
    const parsed = actionSchema.safeParse(ctx.payload);
    if (!parsed.success) throw new Error("Invalid action");
    const s: DrawTogetherState = structuredClone(state);
    const act = parsed.data;

    if (act.action === "stroke") {
      // Flood guard: cap points each user may add between broadcasts.
      const recentUserPoints = s.strokes
        .filter((st) => st.userId === ctx.userId && st.seq > s.seq - 200)
        .reduce((acc, st) => acc + st.points.length, 0);
      if (recentUserPoints > MAX_POINTS_PER_USER_PER_TICK) {
        throw new Error("Slow down a moment — the canvas is catching up");
      }
      if (s.strokes.length >= MAX_STROKES) throw new Error("The canvas is full — start a new round");
      s.seq += 1;
      s.strokes.push({
        id: `s${s.seq}`,
        userId: ctx.userId,
        color: act.stroke.color,
        width: act.stroke.width,
        points: act.stroke.points.map((n) => Math.round(n * 10) / 10),
        mode: act.stroke.mode,
        seq: s.seq,
      });
      return {
        state: s,
        broadcastEvents: [
          {
            event: "game:event",
            payload: { type: "stroke", stroke: s.strokes[s.strokes.length - 1] },
          },
        ],
      };
    }

    if (act.action === "undo") {
      // Remove the caller's own last stroke only.
      for (let i = s.strokes.length - 1; i >= 0; i--) {
        if (s.strokes[i]!.userId === ctx.userId) {
          const removed = s.strokes.splice(i, 1)[0]!;
          return {
            state: s,
            broadcastEvents: [{ event: "game:event", payload: { type: "undo", strokeId: removed.id, userId: ctx.userId } }],
          };
        }
      }
      return { state: s };
    }

    if (act.action === "clear_mine") {
      const mine = s.strokes.filter((st) => st.userId === ctx.userId).map((st) => st.id);
      s.strokes = s.strokes.filter((st) => st.userId !== ctx.userId);
      return {
        state: s,
        broadcastEvents: [{ event: "game:event", payload: { type: "clear_mine", ids: mine, userId: ctx.userId } }],
      };
    }

    // finish — any player can propose finishing; game completes immediately.
    s.status = "completed";
    return { state: s, completed: true, systemMessages: ["The canvas was declared finished 🎨"] };
  },

  tick(state, ctx) {
    if (state.deadline && ctx.now > state.deadline) {
      const s = structuredClone(state);
      s.status = "completed";
      return { state: s, completed: true, systemMessages: ["Time! Pencils down."] };
    }
    return null;
  },

  scoreSummary() {
    return [];
  },

  view(state, userId) {
    return {
      kind: "draw_together",
      mode: state.mode,
      templateId: state.templateId,
      templateStrokes: state.templateStrokes,
      strokes: state.strokes,
      deadline: state.deadline,
      myUserId: userId,
    };
  },
};

function loadTemplateStrokes(templateId: string): Stroke[] {
  const rows = sampleGenericContent("prompt", "draw_template", 50);
  const found = rows.find((r) => {
    try {
      const parsed = JSON.parse(r.body ?? "{}") as { id?: string };
      return parsed.id === templateId;
    } catch {
      return false;
    }
  });
  if (!found?.body) return [];
  try {
    const tpl = JSON.parse(found.body) as { strokes?: Array<{ c: string; w: number; p: number[] }> };
    return (tpl.strokes ?? []).map((st, i) => ({
      id: `t${i}`,
      userId: "template",
      color: st.c,
      width: st.w,
      points: st.p,
      mode: "pen" as const,
      seq: -(i + 1),
    }));
  } catch {
    return [];
  }
}
