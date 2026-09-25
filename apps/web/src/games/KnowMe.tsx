import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { useCountdown } from "../lib/useCountdown";
import { GameChrome, Scores } from "../components/GameChrome";

interface View {
  round: number;
  totalRounds: number;
  current: {
    subjectName: string;
    question: string;
    isSubject: boolean;
    myAnswer: string | null;
    myGuess: string | null;
    revealed: boolean;
    realAnswer: string | null;
    guesses: Array<{ userId: string; name: string; guess: string; hit: boolean }> | null;
    guessCount: number;
    deadline: number;
  } | null;
  scores: Record<string, { score: number; name: string }>;
}

export function KnowMe({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remaining = useCountdown(v.current?.deadline);

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
    else setAnswer("");
  };

  const cur = v.current;
  if (!cur) {
    return (
      <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
        <p className="muted">Starting the next round…</p>
        <button className="btn btn-primary" onClick={() => void act("next")}>
          Begin
        </button>
      </GameChrome>
    );
  }

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
      <p className="muted small">
        {cur.isSubject ? "You answer this in secret —" : `${cur.subjectName} answers this in secret —`}{" "}
        everyone else guesses what they said.
      </p>
      <p className="game-prompt">{cur.question}</p>

      {!cur.revealed && cur.isSubject && !cur.myAnswer && (
        <form
          className="row"
          style={{ maxWidth: 480, width: "100%" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) void act("submit_answer", { answer: answer.trim() });
          }}
        >
          <input
            className="input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your honest answer…"
            maxLength={120}
            autoFocus
            aria-label="Your answer"
          />
          <button className="btn btn-primary">Lock in</button>
        </form>
      )}

      {!cur.revealed && cur.isSubject && cur.myAnswer && (
        <p className="muted">Answer locked ✓ — waiting for the guesses…</p>
      )}

      {!cur.revealed && !cur.isSubject && (
        <form
          className="row"
          style={{ maxWidth: 480, width: "100%" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) void act("guess", { answer: answer.trim() });
          }}
        >
          <input
            className="input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={`What would ${cur.subjectName} say?`}
            maxLength={120}
            disabled={!!cur.myGuess}
            autoFocus
            aria-label="Your guess"
          />
          <button className="btn btn-primary" disabled={!!cur.myGuess}>
            {cur.myGuess ? "Guessed ✓" : "Guess"}
          </button>
        </form>
      )}

      {!cur.revealed && !cur.isSubject && cur.myGuess && (
        <p className="faint small">You guessed: “{cur.myGuess}”</p>
      )}

      {cur.revealed && (
        <div className="stack" style={{ width: "100%", maxWidth: 520 }}>
          <p className="game-prompt">
            {cur.subjectName} said: “{cur.realAnswer}”
          </p>
          <div className="stack">
            {(cur.guesses ?? []).map((g) => (
              <div key={g.userId} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{g.name}</strong> guessed “{g.guess}”
                </span>
                <span className={`badge ${g.hit ? "badge-good" : ""}`}>{g.hit ? "hit +1" : "miss"}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => void act("next")}>
            {v.round >= v.totalRounds ? "See results" : "Next round"}
          </button>
        </div>
      )}

      {remaining !== null && !cur.revealed && (
        <p className="game-timer">{remaining}s</p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Scores scores={v.scores} />
    </GameChrome>
  );
}
