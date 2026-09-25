import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { GameChrome } from "../components/GameChrome";

interface Line {
  userId: string;
  authorName: string;
  text: string;
  at: number;
}

interface View {
  opener: string;
  lines: Line[];
  currentAuthorId: string | null;
  isMyTurn: boolean;
  status: string;
}

export function StoryTogether({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const { user } = useSession();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [v.lines.length]);

  const submit = async (): Promise<void> => {
    if (!text.trim()) return;
    setError(null);
    const res = await gameAction("add_line", { text: text.trim() });
    if (!res.ok) setError(res.error ?? "That didn't work");
    else setText("");
  };

  const done = v.status === "completed" || state.__completed === true;

  return (
    <GameChrome>
      <div style={{ width: "100%", maxWidth: 680, textAlign: "left" }}>
        <p className="faint small" style={{ marginBottom: "var(--sp-4)" }}>
          {done ? "The complete story" : "Add one sentence per turn — build it together"}
        </p>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-md)", marginBottom: "var(--sp-4)" }}>
          {v.opener}
        </p>
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          {v.lines.map((l, i) => (
            <p key={i}>
              <span className="faint small" style={{ marginRight: 8 }}>
                {l.authorName}:
              </span>
              {l.text}
            </p>
          ))}
          <div ref={endRef} />
        </div>

        {!done && (
          <div className="mt-8">
            {v.isMyTurn ? (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <textarea
                  className="textarea"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Your sentence continues the story…"
                  maxLength={240}
                  autoFocus
                  aria-label="Your sentence"
                />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="faint small">{240 - text.length} characters left</span>
                  <button className="btn btn-primary" disabled={text.trim().length < 3}>
                    Add line
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted small">
                Waiting for{" "}
                <strong>{v.lines.length >= 0 ? authorName(v, v.currentAuthorId) : "someone"}</strong> to
                write the next line…
              </p>
            )}
          </div>
        )}

        {done && (
          <p className="muted small mt-8">
            This story lives in your room's game history{user ? "" : ""}. The full text is in the
            chat log above.
          </p>
        )}

        {!done && v.lines.length >= 3 && (
          <button className="btn btn-ghost btn-sm mt-4" onClick={() => void gameAction("finish_story")}>
            End the story here
          </button>
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

function authorName(v: View, id: string | null): string {
  return v.lines.find((l) => l.userId === id)?.authorName ?? "someone";
}
