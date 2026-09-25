import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { PrivacySettings, SelfProfile } from "@hearth/shared";

export function Settings(): ReactNode {
  const { user, setUser } = useSession();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  if (!user) return null;

  const savePrivacy = async (patch: Partial<PrivacySettings>): Promise<void> => {
    setError(null);
    try {
      const me = await api.patch<SelfProfile>("/api/auth/profile", {
        privacy: { ...user.privacy, ...patch },
      });
      setUser(me);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  };

  const changePassword = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setPwMsg(null);
    setError(null);
    try {
      await api.post("/api/auth/password", { currentPassword, newPassword });
      setPwMsg("Password updated. Other devices were signed out.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    }
  };

  const p = user.privacy;

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Settings</h1>
        <p>Your data, your call. These controls are enforced on the server, not just hidden in the UI.</p>
      </div>

      <div className="card mb-4">
        <h3 className="mb-4">Privacy</h3>
        <div className="field">
          <label htmlFor="pv">Who can see your profile</label>
          <select
            id="pv"
            className="select"
            value={p.profileVisibility}
            onChange={(e) => void savePrivacy({ profileVisibility: e.target.value as PrivacySettings["profileVisibility"] })}
          >
            <option value="everyone">Everyone</option>
            <option value="friends">Friends only</option>
            <option value="private">Only me</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fr">Who can send friend requests</label>
          <select
            id="fr"
            className="select"
            value={p.friendRequests}
            onChange={(e) => void savePrivacy({ friendRequests: e.target.value as PrivacySettings["friendRequests"] })}
          >
            <option value="everyone">Anyone</option>
            <option value="friends_of_friends">Friends of friends</option>
            <option value="nobody">Nobody</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ri">Who can invite you to rooms</label>
          <select
            id="ri"
            className="select"
            value={p.roomInvites}
            onChange={(e) => void savePrivacy({ roomInvites: e.target.value as PrivacySettings["roomInvites"] })}
          >
            <option value="everyone">Anyone</option>
            <option value="friends">Friends only</option>
            <option value="nobody">Nobody</option>
          </select>
        </div>
        <label className="row" style={{ justifyContent: "space-between" }}>
          <span>Show when I'm online</span>
          <input
            type="checkbox"
            checked={p.showOnlineStatus}
            onChange={(e) => void savePrivacy({ showOnlineStatus: e.target.checked })}
            style={{ width: 20, height: 20, accentColor: "var(--amber-400)" }}
          />
        </label>
        {saved && <p className="badge badge-good mt-4" style={{ display: "inline-flex" }}>Saved ✓</p>}
        {error && (
          <p className="field-error mt-4" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="mb-4">Change password</h3>
        <form onSubmit={(e) => void changePassword(e)} noValidate>
          <div className="field">
            <label htmlFor="cp">Current password</label>
            <input
              id="cp"
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="np">New password</label>
            <input
              id="np"
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={10}
            />
            <span className="field-hint">At least 10 characters with a letter and a number.</span>
          </div>
          {pwMsg && <p className="badge badge-good mb-4" style={{ display: "inline-flex" }}>{pwMsg}</p>}
          {error && (
            <p className="field-error mb-4" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-secondary" disabled={newPassword.length < 10}>
            Update password
          </button>
        </form>
      </div>
    </div>
  );
}
