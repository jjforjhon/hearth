import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { GameId } from "@hearth/shared";

interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  approxMinutes: number;
  style: string;
}

const STYLE_LABEL: Record<string, string> = {
  conversation: "Conversation",
  creative: "Creative",
  cooperative: "Co-op",
  quiz: "Quick-fire",
  cards: "Card game",
  board: "Board game",
};

export function Games(): ReactNode {
  const { user } = useSession();
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ games: GameMeta[] }>("/api/games")
      .then((d) => setGames(d.games))
      .catch(() => setError("Couldn't load the game shelf."))
      .finally(() => setLoading(false));
  }, []);

  const createRoom = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const name = `${user?.displayName ?? "Someone"}'s room`;
      const res = await api.post<{ room: { id: string; code: string } }>("/api/rooms", { name });
      navigate(`/room/${res.room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a room");
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head row row-wrap" style={{ justifyContent: "space-between", gap: "var(--sp-4)" }}>
        <div>
          <h1>Games</h1>
          <p>Pick a game and we'll make a room for it. Share the code, wait for your people, play.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void createRoom()} disabled={creating}>
          {creating ? "Creating…" : "Start a room"}
        </button>
      </div>

      {error && (
        <p className="field-error mb-4" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="empty">
          <span className="spinner" aria-label="Loading games" />
        </div>
      ) : (
        <div className="grid-games">
          {games.map((g) => (
            <Link key={g.id} to={`/room/new?game=${g.id}`} className="game-card">
              <h3>{g.name}</h3>
              <p className="muted small">{g.tagline}</p>
              <div className="game-card-meta">
                <span className="badge">{STYLE_LABEL[g.style] ?? g.style}</span>
                <span className="badge">
                  {g.minPlayers}–{g.maxPlayers} players
                </span>
                <span className="badge">~{g.approxMinutes} min</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card mt-8">
        <h3 className="mb-4">Have a code?</h3>
        <JoinForm />
      </div>
    </div>
  );
}

function JoinForm(): ReactNode {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim().length >= 4) navigate(`/join/${code.trim().toUpperCase()}`);
      }}
    >
      <input
        className="input"
        placeholder="e.g. K7PM2X"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={8}
        aria-label="Room code"
        style={{ maxWidth: 200 }}
      />
      <button className="btn btn-secondary">Join room</button>
    </form>
  );
}
