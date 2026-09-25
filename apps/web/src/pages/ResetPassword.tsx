import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

export function ResetPassword(): ReactNode {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [identifier, setIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestReset = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/password-reset", { identifier });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/password-reset/confirm", { token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link may have expired");
    } finally {
      setBusy(false);
    }
  };

  if (token) {
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <h1>Choose a new password</h1>
        </div>
        {done ? (
          <p className="muted">
            Password updated. <Link to="/login">Sign in</Link> with your new password.
          </p>
        ) : (
          <form onSubmit={(e) => void confirmReset(e)} noValidate>
            <div className="field">
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                autoFocus
              />
              <span className="field-hint">At least 10 characters with a letter and a number.</span>
            </div>
            {error && (
              <p className="field-error mb-4" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-block" disabled={busy || newPassword.length < 10}>
              Update password
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Reset your password</h1>
        <p>Enter your username or email and we'll create a reset link.</p>
      </div>
      {done ? (
        <p className="muted">
          If that account exists, a reset link has been created. Check with the person running
          this Hearth instance for the message — this deployment may not have email configured.
        </p>
      ) : (
        <form onSubmit={(e) => void requestReset(e)} noValidate>
          <div className="field">
            <label htmlFor="identifier">Username or email</label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
          </div>
          {error && (
            <p className="field-error mb-4" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            Create reset link
          </button>
        </form>
      )}
      <p className="muted mt-4 small">
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
