import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import type { FriendRequestView, FriendView } from "@hearth/shared";

interface FriendsData {
  friends: FriendView[];
  requests: FriendRequestView[];
  blocked: string[];
}

export function Friends(): ReactNode {
  const [data, setData] = useState<FriendsData | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = (): void => {
    api
      .get<FriendsData>("/api/friends")
      .then(setData)
      .catch(() => setError("Couldn't load friends"));
  };

  useEffect(load, []);

  const addFriend = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.post("/api/friends/requests", { username: username.trim() });
      setNotice(`Request sent to @${username.trim()}`);
      setUsername("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    }
  };

  const accept = async (id: string): Promise<void> => {
    await api.post(`/api/friends/requests/${id}/accept`).catch(() => {});
    load();
  };

  const decline = async (id: string): Promise<void> => {
    await api.post(`/api/friends/requests/${id}/decline`).catch(() => {});
    load();
  };

  const remove = async (userId: string): Promise<void> => {
    await api.del(`/api/friends/${userId}`).catch(() => {});
    load();
  };

  const block = async (userId: string): Promise<void> => {
    await api.post("/api/blocks", { userId }).catch(() => {});
    load();
  };

  if (!data) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
        <span className="spinner" aria-label="Loading friends" />
      </div>
    );
  }

  const incoming = data.requests.filter((r) => r.direction === "incoming");
  const outgoing = data.requests.filter((r) => r.direction === "outgoing");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Friends</h1>
        <p>Find people by their exact username. Privacy settings decide who can invite whom.</p>
      </div>

      <form className="row mb-4" onSubmit={(e) => void addFriend(e)}>
        <input
          className="input"
          placeholder="@username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="Username to add"
          style={{ maxWidth: 240 }}
        />
        <button className="btn btn-secondary">Send request</button>
      </form>

      {error && (
        <p className="field-error mb-4" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="badge badge-good mb-4" style={{ display: "inline-flex" }}>
          {notice}
        </p>
      )}

      {incoming.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-4">Requests</h3>
          <div className="stack">
            {incoming.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{r.displayName}</strong> <span className="faint">@{r.username}</span>
                </span>
                <span className="row">
                  <button className="btn btn-primary btn-sm" onClick={() => void accept(r.id)}>
                    Accept
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void decline(r.id)}>
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-4">Sent, waiting</h3>
          <div className="stack">
            {outgoing.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{r.displayName}</strong> <span className="faint">@{r.username}</span>
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => void decline(r.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.friends.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden>
            ◌
          </div>
          <h3>No friends yet</h3>
          <p>Send a request above, or share a room invite — friends you make in rooms appear here.</p>
        </div>
      ) : (
        <div className="stack">
          {data.friends.map((f) => (
            <div key={f.userId} className="player-chip">
              <span className="avatar avatar-36" aria-hidden>
                {f.avatarUrl ? <img src={f.avatarUrl} alt="" /> : f.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="player-chip-name">
                <div style={{ fontWeight: 500 }}>
                  {f.displayName}{" "}
                  {f.online && <span className="badge badge-good">online</span>}
                </div>
                <div className="faint small">@{f.username}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => void remove(f.userId)}>
                Unfriend
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void block(f.userId)}>
                Block
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
