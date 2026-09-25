import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { SelfProfile } from "@hearth/shared";

export function Register(): ReactNode {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordOk = password.length >= 10 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const usernameOk = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!usernameOk || !passwordOk || !email.includes("@") || displayName.trim().length === 0) {
      setError("Please check the fields — all of them are needed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<SelfProfile>("/api/auth/register", {
        username,
        email,
        password,
        displayName: displayName.trim(),
      });
      setUser(me);
      navigate("/games");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Join Hearth</h1>
        <p>One account, your rooms and friends. No real name needed — pick something comfortable.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
          <span className="field-hint">3–20 characters: letters, numbers, underscore.</span>
        </div>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <span className="field-hint">What friends see in rooms and chat.</span>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <span className="field-hint">Only used for account recovery. Never shown to others.</span>
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <span className="field-hint">
            {password.length < 10
              ? "At least 10 characters."
              : !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)
                ? "Mix in at least one letter and one number."
                : "Looks good."}
          </span>
        </div>
        {error && (
          <p className="field-error mb-4" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !usernameOk || !passwordOk}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="muted mt-4 small">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
