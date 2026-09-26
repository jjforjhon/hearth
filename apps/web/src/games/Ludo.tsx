import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { GameChrome } from "../components/GameChrome";

/**
 * Ludo UI — 15×15 cross-shaped board rendered on a CSS grid. Each cell maps to
 * one of the 52 track cells, 5 home-column cells per color, or a base/finish
 * zone. Tokens are colored dots positioned by step count (server state) — the
 * client never computes rules, only displays.
 */

type Color = "red" | "green" | "yellow" | "blue";

interface PlayerRow {
  id: string;
  name: string;
  color: Color;
  tokensHome: number;
  captures: number;
}

interface View {
  players: PlayerRow[];
  tokens: Record<string, number[]>; // color -> 4 step counts (-1 base .. 56 home)
  dice: number | null;
  diceRolled: boolean;
  turnId: string | null;
  isMyTurn: boolean;
  myColor: Color | null;
  legalTokens: number[];
  sixStreak: number;
  winnerId: string | null;
}

const PLAYER_HEX: Record<Color, string> = {
  red: "#e5484d",
  green: "#2f9e63",
  yellow: "#e6a700",
  blue: "#3b82f6",
};

const START_CELL: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
const HOME = 56;
const TRACK_END = 50;
const BASE = -1;

/** The 52 track cells in play order (col,row) on a 15×15 grid.
 *  Red starts at [1,6] moving east; indexes 13/26/39 are the green/yellow/blue
 *  starts; index 50/11/24/37 are the home-column entrances. */
const TRACK: Array<[number, number]> = [
  // east along row 6 (red start)
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // north up column 6
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  // top middle
  [7, 0],
  // south down column 8 (green side)
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // east along row 6
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  // right middle
  [14, 7],
  // west along row 8
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // south down column 8 (yellow side)
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  // bottom middle
  [7, 14],
  // north up column 6 (blue side)
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // west along row 8
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  // left middle (red home entry at index 50, then the loop closes)
  [0, 7], [0, 6],
];

// Sanity: the loop must have exactly 52 cells.
if (TRACK.length !== 52) {
  throw new Error(`Track definition broken: ${TRACK.length} cells (expected 52)`);
}

const STAR_CELLS = new Set([8, 21, 34, 47]); // star squares: 8 steps past each start
const HOME_COL: Record<Color, number[]> = {
  red: [51, 52, 53, 54, 55],
  green: [51, 52, 53, 54, 55],
  yellow: [51, 52, 53, 54, 55],
  blue: [51, 52, 53, 54, 55],
};

function trackCellOf(color: Color, step: number): [number, number] {
  const start = START_CELL[color];
  return TRACK[(start + step) % 52]!;
}

function homeCellOf(color: Color, step: number): [number, number] {
  // Home columns run from each arm's middle edge toward the center.
  const t = step - 51; // 0..4
  switch (color) {
    case "red":
      return [1 + t, 7];
    case "green":
      return [7, 1 + t];
    case "yellow":
      return [13 - t, 7];
    case "blue":
      return [7, 13 - t];
  }
}

function posToCell(color: Color, pos: number): [number, number] | null {
  if (pos === BASE) return null;
  if (pos >= 51) return homeCellOf(color, Math.min(pos, 55));
  if (pos === HOME) return null; // finished tokens show in the finish zone
  return trackCellOf(color, pos);
}

export function Ludo({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const [error, setError] = useState<string | null>(null);

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
  };

  const tokenDots: Array<{ key: string; col: number; row: number; color: Color; idx: number; home: boolean }> = [];
  for (const [color, positions] of Object.entries(v.tokens)) {
    (positions as number[]).forEach((pos, i) => {
      if (pos === HOME) return;
      const cell = posToCell(color as Color, pos);
      if (!cell) return;
      tokenDots.push({ key: `${color}-${i}`, col: cell[0], row: cell[1], color: color as Color, idx: i, home: false });
    });
  }

  const turnName = v.players.find((p) => p.id === v.turnId)?.name ?? "…";
  const colorsInPlay = v.players.map((p) => p.color);

  return (
    <GameChrome>
      <div className="stack" style={{ width: "100%", maxWidth: 560, alignItems: "center" }}>
        {/* Players strip */}
        <div className="row row-wrap" style={{ justifyContent: "center", gap: "var(--sp-3)" }}>
          {v.players.map((p) => (
            <span
              key={p.id}
              className={`badge${p.id === v.turnId ? " badge-accent" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: PLAYER_HEX[p.color], display: "inline-block" }} />
              {p.id === v.turnId ? "▶ " : ""}{p.name} · {p.tokensHome}/4 home · {p.captures} ✕
            </span>
          ))}
        </div>

        {/* Board */}
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: "repeat(15, 1fr)",
            gridTemplateRows: "repeat(15, 1fr)",
            borderRadius: 12,
            background: "#f5efe2",
            border: "2px solid #d8cfb8",
            boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
            overflow: "hidden",
          }}
        >
          {/* Yards */}
          {(["red", "green", "yellow", "blue"] as Color[]).map((c) => (
            <div
              key={`yard-${c}`}
              style={{
                gridArea: c === "red" ? "1 / 1 / 7 / 7" : c === "green" ? "1 / 10 / 7 / 16" : c === "yellow" ? "10 / 10 / 16 / 16" : "10 / 1 / 16 / 7",
                margin: 4,
                borderRadius: 10,
                background: PLAYER_HEX[c],
                opacity: colorsInPlay.includes(c) ? 1 : 0.25,
                display: "grid",
                placeItems: "center",
              }}
            >
              <div style={{ width: "70%", height: "70%", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PLAYER_HEX[c] }}>
                  {v.tokens[c]?.filter((p) => p === BASE).length ?? 0} ⌂
                </span>
              </div>
            </div>
          ))}

          {/* Center finish */}
          <div
            style={{
              gridArea: "6 / 6 / 10 / 10",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gridTemplateRows: "1fr 1fr",
              transform: "rotate(45deg)",
              border: "2px solid #d8cfb8",
            }}
          >
            {(["red", "green", "yellow", "blue"] as Color[]).map((c) => (
              <div key={`fin-${c}`} style={{ background: PLAYER_HEX[c], opacity: colorsInPlay.includes(c) ? 1 : 0.3 }} />
            ))}
          </div>

          {/* Home-column cells (tinted tracks into center) */}
          {(["red", "green", "yellow", "blue"] as Color[]).flatMap((c) =>
            HOME_COL[c].map((step, i) => {
              const [col, row] = homeCellOf(c, step);
              return (
                <div
                  key={`hc-${c}-${i}`}
                  style={{
                    gridColumn: col + 1,
                    gridRow: row + 1,
                    background: PLAYER_HEX[c],
                    opacity: colorsInPlay.includes(c) ? 0.75 : 0.15,
                    border: "1px solid rgba(255,255,255,0.5)",
                  }}
                />
              );
            }),
          )}

          {/* Track cells */}
          {TRACK.map(([col, row], i) => {
            const isStart = colorsInPlay.some((c) => START_CELL[c] === i);
            const startColor = colorsInPlay.find((c) => START_CELL[c] === i);
            const isStar = STAR_CELLS.has(i);
            const homeEntry = colorsInPlay.find((c) => (START_CELL[c] + TRACK_END) % 52 === i);
            return (
              <div
                key={`tc-${i}`}
                style={{
                  gridColumn: col + 1,
                  gridRow: row + 1,
                  border: "1px solid rgba(0,0,0,0.18)",
                  background: isStart && startColor ? PLAYER_HEX[startColor] : "rgba(255,255,255,0.55)",
                  opacity: colorsInPlay.some((c) => START_CELL[c] === i || (START_CELL[c] + 50) % 52 === i) ? 1 : 0.55,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 8,
                  color: "#7a6f52",
                }}
              >
                {isStar ? "★" : homeEntry ? "⌂" : ""}
              </div>
            );
          })}

          {/* Tokens */}
          {tokenDots.map((t) => {
            const mine = v.isMyTurn && v.myColor === t.color && v.legalTokens.includes(t.idx);
            return (
              <button
                key={t.key}
                onClick={() => mine && void act("move", { token: t.idx })}
                disabled={!mine}
                style={{
                  gridColumn: t.col + 1,
                  gridRow: t.row + 1,
                  justifySelf: "center",
                  alignSelf: "center",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: PLAYER_HEX[t.color],
                  border: mine ? "2px solid #111" : "1.5px solid rgba(255,255,255,0.85)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                  padding: 0,
                  cursor: mine ? "pointer" : "default",
                  zIndex: 2,
                }}
                aria-label={`${t.color} token ${t.idx + 1}${mine ? " — movable" : ""}`}
              />
            );
          })}
        </div>

        {/* Dice + turn controls */}
        <div className="row row-wrap" style={{ gap: "var(--sp-4)", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 10,
              background: "#fff",
              border: "2px solid #d8cfb8",
              display: "grid",
              placeItems: "center",
              fontSize: 24,
              fontWeight: 800,
            }}
            aria-label={`Dice: ${v.dice ?? "not rolled"}`}
          >
            {v.dice ?? "?"}
          </div>
          {v.isMyTurn && v.winnerId === null && (
            <button className="btn btn-primary" disabled={v.diceRolled} onClick={() => void act("roll")}>
              {v.diceRolled ? "Move a token" : "Roll the dice"}
            </button>
          )}
          {!v.isMyTurn && v.winnerId === null && <p className="muted">Waiting for {turnName}…</p>}
          {v.winnerId !== null && (
            <p style={{ fontWeight: 700 }}>
              🏆 {v.players.find((p) => p.id === v.winnerId)?.name ?? "Someone"} brought all four tokens home!
            </p>
          )}
        </div>

        {v.isMyTurn && v.diceRolled && v.legalTokens.length === 0 && (
          <p className="muted small">No legal move with this roll — the turn will pass.</p>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </GameChrome>
  );
}
