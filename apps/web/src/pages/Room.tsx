import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { ChatPanel } from "../components/ChatPanel";
import { PlayerList } from "../components/PlayerList";
import { GameStage } from "../components/GameStage";
import type { GameId } from "@hearth/shared";

export function RoomPage(): ReactNode {
  const { code = "" } = useParams();
  const roomCtx = useRoom();
  const { room, loading, error } = roomCtx;
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      void roomCtx.leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !room) {
    return (
      <div className="page page-narrow">
        <div className="card" style={{ textAlign: "center" }}>
          <div className="empty-icon" aria-hidden>
            ⚠
          </div>
          <h1 style={{ fontSize: "var(--fs-xl)", marginBottom: "var(--sp-3)" }}>Can't open this room</h1>
          <p className="muted mb-4">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/games")}>
            Back to games
          </button>
        </div>
      </div>
    );
  }

  if (loading || !room) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <span className="spinner" aria-label="Opening room" />
      </div>
    );
  }

  return (
    <div className="room-shell">
      <div className="room-main">
        <div className="room-stage">
          <RoomHeader />
          {room.status === "lobby" ? <Lobby /> : <GameStage />}
        </div>
        <aside className="room-side">
          <PlayerList />
          <div className="room-chat">
            <ChatPanel sessionId={roomCtx.gameSessionId} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function RoomHeader(): ReactNode {
  const { room } = useRoom();
  const { user } = useSession();
  const [copied, setCopied] = useState(false);
  if (!room || !user) return null;

  const copyInvite = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="row row-wrap"
      style={{
        padding: "var(--sp-3) var(--sp-4)",
        borderBottom: "1px solid var(--ink-700)",
        justifyContent: "space-between",
      }}
    >
      <div className="row" style={{ minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{room.name}</div>
          <div className="faint small">
            Code <span style={{ fontFamily: "var(--font-mono)", color: "var(--amber-300)" }}>{room.code}</span>
          </div>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={() => void copyInvite()}>
          {copied ? "Link copied ✓" : "Copy invite link"}
        </button>
      </div>
    </div>
  );
}

function Lobby(): ReactNode {
  const { room, gameAction } = useRoom();
  const { user } = useSession();
  const [games, setGames] = useState<Array<{ id: GameId; name: string; tagline: string; minPlayers: number; maxPlayers: number }>>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ games: typeof games }>("/api/games")
      .then((d) => setGames(d.games))
      .catch(() => {});
  }, []);

  if (!room || !user) return null;
  const isHost = room.hostId === user.id;
  const selectedGame = games.find((g) => g.id === room.gameId);
  const allReady = room.members.filter((m) => m.role !== "host").every((m) => m.ready);
  const canStart = isHost && room.gameId && allReady && room.members.length >= (selectedGame?.minPlayers ?? 2);

  const toggleReady = async (): Promise<void> => {
    const me = room.members.find((m) => m.userId === user.id);
    await api.post(`/api/rooms/${room.id}/ready`, { ready: !(me?.ready ?? false) });
  };

  const start = async (): Promise<void> => {
    try {
      await api.post(`/api/rooms/${room.id}/start`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not start the game");
    }
  };

  return (
    <div className="page" style={{ flex: 1 }}>
      <div className="page-head row row-wrap" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-xl)" }}>Lobby</h1>
          <p>{isHost ? "Pick a game — everyone sees your choice instantly." : "The host is picking a game."}</p>
        </div>
        <div className="row">
          {!isHost && (
            <button className="btn btn-secondary" onClick={() => void toggleReady()}>
              {room.members.find((m) => m.userId === user.id)?.ready ? "I'm ready ✓" : "Mark ready"}
            </button>
          )}
          {isHost && (
            <button className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
              Start game
            </button>
          )}
        </div>
      </div>

      <div className="grid-games">
        {games.map((g) => (
          <button
            key={g.id}
            className={`game-card${room.gameId === g.id ? " selected" : ""}`}
            onClick={() => isHost && api.post(`/api/rooms/${room.id}/game`, { gameId: g.id })}
            disabled={!isHost}
            aria-pressed={room.gameId === g.id}
          >
            <h3>{g.name}</h3>
            <p className="muted small">{g.tagline}</p>
            <div className="game-card-meta">
              <span className="badge">
                {g.minPlayers}–{g.maxPlayers} players
              </span>
            </div>
          </button>
        ))}
      </div>

      {isHost && !room.gameId && (
        <p className="muted small mt-4">Select a game above to enable Start.</p>
      )}
      {isHost && room.gameId && !allReady && (
        <p className="muted small mt-4">Waiting for everyone to mark ready…</p>
      )}
    </div>
  );
}
