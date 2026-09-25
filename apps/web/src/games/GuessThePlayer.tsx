import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { useCountdown } from "../lib/useCountdown";
import { GameChrome, Scores } from "../components/GameChrome";

interface View {
  round: number;
  totalRounds: number;
  current: {
    prompt: string;
    phase: "submitting" | "guessing" | "revealed";
    mySubmission: string | null;
    submittedCount: number;
    items: Array<{ token: string; text: string; myGuess: string | null }> | null;
    revealed: Array<{
      token: string;
      text: string;
      authorId: string;
      authorName: string;
      guessedBy: string[];
    }> | null;
    deadline: number;
  } | null;
  scores: Record<string, number>;
}

export function GuessThePlayer({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { room, gameAction } = useRoom();
  const { user } = useSession();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remaining = useCountdown(v.current?.deadline);

  const nameOf = (id: string): string =>
    room?.members.find((m) => m.userId === id)?.displayName ?? "Someone";

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
    else if (action === "submit") setText("");
  };

  const cur = v.current;
  if (!cur) {
    return (
      <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
        <p className="muted">Writing the next prompt…</p>
        <button className="btn btn-primary" onClick={() => void act("next")}>
          Begin
        </button>
      </GameChrome>
    );
  }

  const options = room?.members.map((m) => m.userId) ?? [];

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
      <p className="game-prompt">{cur.prompt}</p>

      {cur.phase === "submitting" && (
        <>
          <form
            className="row"
            style={{ maxWidth: 520, width: "100%" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void act("submit", { text: text.trim() });
            }}
          >
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={cur.mySubmission ? cur.mySubmission : "Your honest answer…"}
              maxLength={140}
              disabled={!!cur.mySubmission}
              autoFocus={!cur.mySubmission}
              aria-label="Your answer"
            />
            <button className="btn btn-primary" disabled={!!cur.mySubmission || !text.trim()}>
              {cur.mySubmission ? "In ✓" : "Submit"}
            </button>
          </form>
          <p className="game-timer">
            Anonymous until the reveal · {cur.submittedCount} submitted
            {remaining !== null && ` · ${remaining}s`}
          </p>
        </>
      )}

      {cur.phase === "guessing" && cur.items && (
        <div className="stack" style={{ width: "100%", maxWidth: 560 }}>
          <p className="muted small">Who said it? You can't pick yourself.</p>
          {cur.items.map((item) => (
            <div key={item.token} className="card card-tight" style={{ textAlign: "left" }}>
              <p style={{ marginBottom: "var(--sp-2)" }}>“{item.text}”</p>
              <div className="row row-wrap">
                {options
                  .filter((id) => id !== user?.id)
                  .map((id) => (
                    <button
                      key={id}
                      className={`btn btn-sm ${item.myGuess === id ? "btn-primary" : "btn-secondary"}`}
                      disabled={!!item.myGuess}
                      onClick={() => void act("guess", { token: item.token, authorId: id })}
                    >
                      {nameOf(id)}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <p className="game-timer">{remaining !== null ? `${remaining}s` : ""}</p>
        </div>
      )}

      {cur.phase === "revealed" && cur.revealed && (
        <div className="stack" style={{ width: "100%", maxWidth: 560 }}>
          {cur.revealed.map((r) => (
            <div key={r.token} className="card card-tight" style={{ textAlign: "left" }}>
              <p style={{ marginBottom: "var(--sp-2)" }}>“{r.text}”</p>
              <div className="row row-wrap" style={{ justifyContent: "space-between" }}>
                <span className="badge badge-accent">
                  {r.authorName === user?.displayName ? "You" : r.authorName} wrote it
                </span>
                <span className="faint small">
                  {r.guessedBy.length > 0
                    ? `correctly guessed by ${r.guessedBy.map(nameOf).join(", ")}`
                    : "nobody guessed it"}
                </span>
              </div>
            </div>
          ))}
          <button className="btn btn-primary" onClick={() => void act("next")}>
            {v.round >= v.totalRounds ? "See results" : "Next round"}
          </button>
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Scores scores={withNames(v.scores, nameOf)} />
    </GameChrome>
  );
}

function withNames(
  scores: Record<string, number>,
  nameOf: (id: string) => string,
): Record<string, { score: number; name: string }> {
  return Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, { score, name: nameOf(id) }]));
}
