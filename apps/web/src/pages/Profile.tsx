import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { SelfProfile } from "@hearth/shared";

export function Profile(): ReactNode {
  const { user, setUser } = useSession();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      const me = await api.patch<SelfProfile>("/api/auth/profile", {
        displayName: displayName.trim(),
        bio,
      });
      setUser(me);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  };

  const uploadAvatar = async (file: File): Promise<void> => {
    setUploading(true);
    setError(null);
    try {
      const init = await api.post<{ uploadToken: string }>("/api/media/init", { kind: "avatar" });
      const res = await api.putBody<{ mediaId: string; url: string }>(
        `/api/media/upload/${init.uploadToken}`,
        file,
      );
      const me = await api.patch<SelfProfile>("/api/auth/profile", { avatarMediaId: res.mediaId });
      setUser(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Your profile</h1>
        <p>A little about you — visible in rooms and to friends, per your privacy settings.</p>
      </div>

      <div className="card mb-4">
        <div className="row">
          <span className="avatar avatar-72" aria-hidden>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              user.displayName.slice(0, 1).toUpperCase()
            )}
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{user.displayName}</div>
            <div className="faint small">@{user.username}</div>
            <button
              className="btn btn-ghost btn-sm mt-4"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : user.avatarUrl ? "Change photo" : "Add photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void save(e)} noValidate>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="bio">Short bio</label>
          <textarea
            id="bio"
            className="textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="Two truths and a lie, favorite snack, weekend style…"
          />
          <span className="field-hint">{280 - bio.length} characters left</span>
        </div>
        {error && (
          <p className="field-error mb-4" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary">{saved ? "Saved ✓" : "Save profile"}</button>
      </form>
    </div>
  );
}
