import { type ReactNode } from "react";
import { useRoom } from "../lib/room";

export function GameChrome({
  round,
  totalRounds,
  scores,
  children,
}: {
  round?: number;
  totalRounds?: number;
  scores?: Record<string, { score: number; name: string }> | Record<string, number>;
  children: ReactNode;
}): ReactNode {
  const { gameState } = useRoom();
  const completed = gameState?.__completed === true;
  const standings = (gameState?.__standings as Array<{ displayName: string; score: number }> | undefined) ?? [];

  const entries = Object.entries(scores ?? {}).map(([id, v]) =>
    typeof v === "number" ? { id, score: v, name: "" } : { id, score: v.score, name: v.name },
  );
  const max = Math.max(1, ...entries.map((e) => e.score));

  return (
    <div className="game-panel">
      {(round !== undefined || completed) && (
        <div className="row row-wrap" style={{ justifyContent: "center", gap: "var(--sp-3)" }}>
          {round !== undefined && totalRounds !== undefined && (
            <span className="badge">
              Round {round}/{totalRounds}
            </span>
          )}
        </div>
      )}
      {completed ? (
        <div className="stack" style={{ width: "100%", maxWidth: 420 }}>
          <h2 style={{ fontSize: "var(--fs-xl)" }}>Game over</h2>
          {standings.length > 0 ? (
            entries.length === 0 && standings.length > 0 ? null : null
          ) : null}
          <div className="stack">
            {standings.map((s, i) => (
              <div key={i} className="score-row">
                <span style={{ width: 28, textAlign: "right" }} className="faint">
                  {i + 1}.
                </span>
                <span className="score-row-name">{s.displayName}</span>
                <span style={{ fontWeight: 600 }}>{s.score}</span>
              </div>
            ))}
          </div>
          <p className="muted small">The room returns to the lobby — play again or pick another game.</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function Scores({ scores }: { scores: Record<string, { score: number; name: string }> }): ReactNode {
  const entries = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  const max = Math.max(1, ...entries.map(([, v]) => v.score));
  return (
    <div className="stack" style={{ width: "100%", maxWidth: 420 }}>
      {entries.map(([id, v]) => (
        <div key={id} className="score-row">
          <span className="score-row-name">{v.name || "Someone"}</span>
          <div className="score-row-bar">
            <div className="score-row-fill" style={{ width: `${(v.score / max) * 100}%` }} />
          </div>
          <span style={{ fontWeight: 600, minWidth: 24, textAlign: "right" }}>{v.score}</span>
        </div>
      ))}
    </div>
  );
}
