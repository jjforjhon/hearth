import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { GameChrome } from "../components/GameChrome";
import { useCountdown } from "../lib/useCountdown";

interface Stroke {
  id: string;
  userId: string;
  color: string;
  width: number;
  points: number[];
  mode: "pen" | "eraser";
  seq: number;
}

interface View {
  mode: "creative" | "template";
  templateId: string | null;
  templateStrokes: Stroke[];
  strokes: Stroke[];
  deadline: number | null;
  myUserId: string | null;
}

const COLORS = ["#1c1813", "#c25b4e", "#d18f24", "#6ea56e", "#6f8fb8", "#8a5fb0", "#b3a687"];
const CANVAS_W = 1000;
const CANVAS_H = 750;

export function DrawTogether({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameEvents, gameAction, connected } = useRoom();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const currentPoints = useRef<number[]>([]);
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(4);
  const [mode, setMode] = useState<"pen" | "eraser">("pen");
  const remaining = useCountdown(v.deadline);
  const pendingStrokes = useRef<Set<string>>(new Set());

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke): void => {
    ctx.save();
    ctx.strokeStyle = s.mode === "eraser" ? "#f3eee2" : s.color;
    ctx.lineWidth = s.mode === "eraser" ? s.width * 6 : s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const pts = s.points;
    if (pts.length < 4) {
      if (pts.length >= 2) {
        ctx.arc(pts[0]!, pts[1]!, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.moveTo((pts[0]! / 1000) * CANVAS_W, (pts[1]! / 1000) * CANVAS_H);
    for (let i = 2; i + 1 < pts.length; i += 2) {
      ctx.lineTo((pts[i]! / 1000) * CANVAS_W, (pts[i + 1]! / 1000) * CANVAS_H);
    }
    ctx.stroke();
    ctx.restore();
  };

  // Render the full canvas from state + events.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#f3eee2";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const s of v.templateStrokes) drawStroke(ctx, s);
    const drawn = new Set<string>();
    for (const s of v.strokes) {
      drawStroke(ctx, s);
      drawn.add(s.id);
    }
    pendingStrokes.current = new Set([...pendingStrokes.current].filter((id) => !drawn.has(id)));
  }, [v]);

  // Apply incremental stroke/undo events for low latency.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    for (const ev of gameEvents) {
      if (ev.type === "stroke") {
        const s = ev.stroke as Stroke;
        if (!pendingStrokes.current.has(s.id)) {
          drawStroke(ctx, s);
          pendingStrokes.current.add(s.id);
        }
      } else if (ev.type === "undo" || ev.type === "clear_mine") {
        // Full re-render handles removals (state is authoritative).
      }
    }
  }, [gameEvents, v]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 750;
    return [x, y];
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = pos(e);
    currentPoints.current = [x, y];
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    const [x, y] = pos(e);
    const pts = currentPoints.current;
    const lx = pts[pts.length - 2]!;
    const ly = pts[pts.length - 1]!;
    // Throttle: skip sub-pixel moves.
    if (Math.abs(x - lx) < 2 && Math.abs(y - ly) < 2) return;
    pts.push(x, y);

    // Live preview: draw the last segment locally.
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.save();
      ctx.strokeStyle = mode === "eraser" ? "#f3eee2" : color;
      ctx.lineWidth = mode === "eraser" ? width * 6 : width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo((lx / 1000) * CANVAS_W, (ly / 1000) * CANVAS_H);
      ctx.lineTo((x / 1000) * CANVAS_W, (y / 1000) * CANVAS_H);
      ctx.stroke();
      ctx.restore();
    }
  };

  const onUp = (): void => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = currentPoints.current;
    if (pts.length >= 4) {
      void gameAction("stroke", {
        stroke: { color, width, points: pts.map((n) => Math.round(n * 10) / 10), mode },
      });
    }
    currentPoints.current = [];
  };

  return (
    <GameChrome>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="draw-toolbar">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`draw-color${color === c && mode === "pen" ? " selected" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                setMode("pen");
              }}
              aria-label={`Color ${c}`}
            />
          ))}
          <input
            type="range"
            className="draw-width"
            min={2}
            max={24}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            aria-label="Brush width"
          />
          <button
            className={`btn btn-sm ${mode === "eraser" ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setMode(mode === "eraser" ? "pen" : "eraser")}
          >
            {mode === "eraser" ? "Eraser on" : "Eraser"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void gameAction("undo")}>
            Undo mine
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void gameAction("clear_mine")}>
            Clear mine
          </button>
          <div className="topnav-spacer" />
          {remaining !== null && <span className="game-timer">{remaining}s left</span>}
          {!connected && <span className="badge badge-alert">reconnecting…</span>}
          <button className="btn btn-primary btn-sm" onClick={() => void gameAction("finish")}>
            Finish
          </button>
        </div>
        <div className="draw-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            aria-label="Shared drawing canvas"
          />
        </div>
        {v.mode === "template" && (
          <p className="faint small" style={{ padding: "var(--sp-2) var(--sp-3)" }}>
            Template mode — complete the outline together.
          </p>
        )}
      </div>
    </GameChrome>
  );
}
