import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { useCountdown } from "../lib/useCountdown";
import { GameChrome, Scores } from "../components/GameChrome";

interface AnswerItem {
  userId: string;
  word: string;
  ms: number;
  duplicate: boolean;
}

interface View {
  round: number;
  totalRounds: number;
  current: {
    word: string;
    myAnswer: string | null;
    answeredCount: number;
    revealed: boolean;
    answers: AnswerItem[] | null;
    deadline: number;
  } | null;
  scores: Record<string, number>;
}

export function WordAssociation({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { room, gameAction } = useRoom();
  const { user } = useSession();
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remaining = useCountdown(v.current?.deadline);

  const nameOf = (id: string): string =>
    room?.members.find((m) => m.userId === id)?.displayName ?? "Someone";

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
    else setWord("");
  };

  const cur = v.current;
  if (!cur) {
    return (
      <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
        <p className="muted">Drawing the next word…</p>
        <button className="btn btn-primary" onClick={() => void act("next")}>
          Begin
        </button>
      </GameChrome>
    );
  }

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
      <p className="muted small">First word that comes to mind — go!</p>
      <p className="game-prompt" style={{ fontSize: "var(--fs-2xl)", fontFamily: "var(--font-display)" }}>
        {cur.word}
      </p>

      {!cur.revealed && (
        <>
          <form
            className="row"
            style={{ maxWidth: 420, width: "100%" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (word.trim()) void act("answer", { word: word.trim() });
            }}
          >
            <input
              className="input"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="Your word…"
              maxLength={40}
              disabled={!!cur.myAnswer}
              autoFocus
              aria-label="Your association"
            />
            <button className="btn btn-primary" disabled={!!cur.myAnswer || !word.trim()}>
              Fire
            </button>
          </form>
          <p className="game-timer">
            {cur.myAnswer ? `You said “${cur.myAnswer}” — ` : ""}
            {cur.answeredCount} in · {remaining !== null ? `${remaining}s` : ""}
          </p>
        </>
      )}

      {cur.revealed && (
        <div className="stack" style={{ width: "100%", maxWidth: 520 }}>
          {(cur.answers ?? []).map((a, i) => (
            <div key={a.userId} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                {i === 0 && <span className="badge badge-accent" style={{ marginRight: 8 }}>fastest</span>}
                <strong>{nameOf(a.userId)}</strong> · “{a.word}”
              </span>
              <span className={`badge ${a.duplicate ? "" : "badge-good"}`}>
                {a.duplicate ? "match +1" : "unique +2"}
              </span>
            </div>
          ))}
          <button className="btn btn-primary" onClick={() => void act("next")}>
            {v.round >= v.totalRounds ? "See results" : "Next word"}
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
