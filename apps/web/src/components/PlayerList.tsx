import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";

export function PlayerList(): ReactNode {
  const { room } = useRoom();
  const { user } = useSession();
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!room || !user) return null;
  const isHost = room.hostId === user.id;

  const kick = async (userId: string): Promise<void> => {
    setConfirmKick(null);
    try {
      await api.post(`/api/rooms/${room.id}/kick`, { userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove player");
    }
  };

  const transfer = async (userId: string): Promise<void> => {
    setError(null);
    try {
      await api.post(`/api/rooms/${room.id}/transfer-host`, { userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not transfer host");
    }
  };

  return (
    <div>
      <div
        className="row row-wrap"
        style={{ padding: "var(--sp-3) var(--sp-4) 0", justifyContent: "space-between" }}
      >
        <h2 style={{ fontSize: "var(--fs-md)" }}>
          Players{" "}
          <span className="faint">
            {room.members.length}/{10}
          </span>
        </h2>
        <span className="badge">{room.status === "playing" ? "Playing" : "Lobby"}</span>
      </div>
      <div className="player-list">
        {room.members.map((m) => (
          <div key={m.userId} className={`player-chip${m.online ? "" : " offline"}`}>
            <span className={`avatar avatar-36`} aria-hidden>
              {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : initials(m.displayName)}
            </span>
            <div className="player-chip-name">
              <div style={{ fontWeight: 500 }}>
                {m.displayName}
                {m.userId === user.id && <span className="faint"> (you)</span>}
              </div>
              <div className="faint small">@{m.username}</div>
            </div>
            {m.role === "host" && <span className="badge badge-accent">host</span>}
            {m.role !== "host" && room.status === "lobby" && (
              <span className={`badge ${m.ready ? "badge-good" : ""}`}>{m.ready ? "ready" : "not ready"}</span>
            )}
            {!m.online && <span className="badge">offline</span>}
            {isHost && m.userId !== user.id && (
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`More actions for ${m.displayName}`}
                onClick={() => setConfirmKick(m.userId)}
              >
                ⋯
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="field-error" style={{ padding: "0 var(--sp-4)" }} role="alert">
          {error}
        </p>
      )}

      {confirmKick && (
        <div className="modal-backdrop" onClick={() => setConfirmKick(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Remove player?</h3>
            <p className="muted mb-4">
              {room.members.find((m) => m.userId === confirmKick)?.displayName} will be able to
              rejoin with the invite link.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setConfirmKick(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void kick(confirmKick)}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
