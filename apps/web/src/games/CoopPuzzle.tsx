import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { GameChrome } from "../components/GameChrome";

interface View {
  round: number;
  totalRounds: number;
  current: {
    type: string;
    body: string;
    hintsRevealed: string[];
    hintsLeft: number;
    wrongGuesses: number;
    solved: boolean;
    solution: string | null;
  } | null;
  teamScore: number;
  lives: number;
}

export function CoopPuzzle({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const [guess, setGuess] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
    else if (action === "guess") setGuess("");
  };

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds}>
      <div className="row row-wrap" style={{ justifyContent: "center", gap: "var(--sp-4)" }}>
        <span className="badge badge-accent">Team score {v.teamScore}</span>
        <span className={`badge ${v.lives <= 1 ? "badge-alert" : "badge-good"}`}>
          {"♥".repeat(Math.max(0, v.lives))}
          {"♡".repeat(Math.max(0, 3 - v.lives))} lives
        </span>
      </div>

      {!v.current && <p className="muted">Preparing the first puzzle…</p>}

      {v.current && !v.current.solved && (
        <>
          <p className="muted small">Puzzle #{v.round} — work it out together in chat</p>
          <p className="game-prompt">{v.current.body}</p>
          <form
            className="row"
            style={{ maxWidth: 480, width: "100%" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (guess.trim()) void act("guess", { text: guess.trim() });
            }}
          >
            <input
              className="input"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="Team answer…"
              maxLength={120}
              aria-label="Team answer"
            />
            <button className="btn btn-primary">Guess</button>
          </form>
          <div className="row row-wrap" style={{ justifyContent: "center" }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={v.current.hintsLeft <= 0}
              onClick={() => void act("hint")}
            >
              Buy hint ({v.current.hintsLeft} left · costs points)
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void act("skip")}>
              Skip (costs a life)
            </button>
          </div>
          {v.current.hintsRevealed.length > 0 && (
            <div className="stack small" style={{ maxWidth: 480 }}>
              {v.current.hintsRevealed.map((h, i) => (
                <p key={i} className="muted">
                  💡 {h}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {v.current?.solved && (
        <>
          <p style={{ color: "var(--green-good)", fontSize: "var(--fs-lg)" }}>
            Solved! The answer was “{v.current.solution}”.
          </p>
          <p className="muted small">The next puzzle loads automatically…</p>
        </>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </GameChrome>
  );
}
