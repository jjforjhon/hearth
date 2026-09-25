import { useRef, useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { GameChrome } from "../components/GameChrome";

interface HistoryItem {
  round: number;
  playerName: string;
  kind: string;
  prompt: string;
  fulfilled: boolean;
  skipped: boolean;
}

interface View {
  round: number;
  order: Array<{ id: string; name: string }>;
  currentPlayerId: string | null;
  current: {
    playerId: string;
    playerName: string;
    kind: "truth" | "dare" | null;
    prompt: string | null;
    category: string | null;
    difficulty: number;
    mediaPolicy: "none" | "optional" | "required";
    mediaKinds: string[];
    mediaSubmitted: boolean;
    isMine: boolean;
  } | null;
  skipsUsed: Record<string, number>;
  maxSkips: number;
  historyTail: HistoryItem[];
}

const MEDIA_LABEL: Record<string, string> = {
  photo: "📷 photo",
  video: "🎥 video",
  voice: "🎙 voice note",
  drawing: "🖌 drawing",
};

export function TruthOrDare({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const { user } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
  };

  const uploadMedia = async (file: File): Promise<void> => {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      const kind =
        file.type.startsWith("image/") ? "photo" : file.type.startsWith("video/") ? "video" : "voice";
      const init = await api.post<{ uploadToken: string }>("/api/media/init", { kind });
      await api.putBody(`/api/media/upload/${init.uploadToken}`, file);
      await act("media_submitted", {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const cur = v.current;
  const myTurn = !!cur?.isMine;
  const skipsLeft = user ? v.maxSkips - (v.skipsUsed[user.id] ?? 0) : 0;

  return (
    <GameChrome round={v.round}>
      {!cur && (
        <>
          <p className="game-prompt">Ready for the next turn?</p>
          <button
            className="btn btn-primary"
            onClick={() => void act("spin")}
            disabled={user?.id !== v.currentPlayerId}
          >
            {user?.id === v.currentPlayerId ? "Spin to start your turn" : `Waiting for ${nameOf(v, v.currentPlayerId)}`}
          </button>
        </>
      )}

      {cur && !cur.kind && (
        <>
          <p className="game-prompt">
            {cur.isMine ? "Your turn —" : `${cur.playerName}'s turn —`} Truth or Dare?
          </p>
          <div className="choice-grid">
            <button className="choice-btn" disabled={!myTurn} onClick={() => void act("choose", { kind: "truth" })}>
              Truth
            </button>
            <button className="choice-btn" disabled={!myTurn} onClick={() => void act("choose", { kind: "dare" })}>
              Dare
            </button>
          </div>
        </>
      )}

      {cur && cur.kind && (
        <>
          <p className="muted small">
            {cur.kind === "truth" ? "Truth" : "Dare"} for {cur.isMine ? "you" : cur.playerName}
            {cur.category && ` · ${cur.category}`} · tier {cur.difficulty}
          </p>
          <p className="game-prompt">{cur.prompt}</p>

          {cur.isMine ? (
            <div className="stack" style={{ width: "100%", maxWidth: 480 }}>
              {cur.mediaPolicy !== "none" && !cur.mediaSubmitted && (
                <p className="small" style={{ color: "var(--amber-300)" }}>
                  {cur.mediaPolicy === "required" ? "This one wants " : "Optional: "}
                  {cur.mediaKinds.map((k) => MEDIA_LABEL[k] ?? k).join(" or ")} — captured privately,
                  shared only with this room.
                </p>
              )}
              {cur.mediaPolicy !== "none" && (
                <input
                  ref={fileRef}
                  type="file"
                  accept={
                    cur.mediaKinds.includes("photo")
                      ? "image/*"
                      : cur.mediaKinds.includes("voice")
                        ? "audio/*"
                        : cur.mediaKinds.includes("video")
                          ? "video/*"
                          : "image/*"
                  }
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadMedia(f);
                  }}
                />
              )}
              <div className="row row-wrap" style={{ justifyContent: "center" }}>
                {cur.mediaPolicy !== "none" && !cur.mediaSubmitted && (
                  <button
                    className="btn btn-secondary"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? "Uploading…" : `Attach ${cur.mediaKinds[0] ?? "media"}`}
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => void act("done")}>
                  Done ✓
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={skipsLeft <= 0}
                  onClick={() => void act("skip")}
                  title={skipsLeft <= 0 ? "No skips left" : `${skipsLeft} skips left`}
                >
                  Skip ({skipsLeft} left)
                </button>
              </div>
            </div>
          ) : (
            <p className="muted small">
              Waiting for {cur.playerName} to complete it
              {cur.mediaSubmitted ? " — media received ✓" : ""}.
            </p>
          )}
        </>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {v.historyTail.length > 0 && (
        <div className="stack small" style={{ width: "100%", maxWidth: 560, marginTop: "var(--sp-6)" }}>
          <div className="faint">Recent turns</div>
          {v.historyTail.slice(-5).reverse().map((h, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between", gap: "var(--sp-3)" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{h.playerName}</strong> · {h.prompt}
              </span>
              <span className={`badge ${h.skipped ? "" : "badge-good"}`}>
                {h.skipped ? "skipped" : h.fulfilled ? "done" : "passed"}
              </span>
            </div>
          ))}
        </div>
      )}
    </GameChrome>
  );
}

function nameOf(v: View, id: string | null): string {
  return v.order.find((o) => o.id === id)?.name ?? "someone";
}
