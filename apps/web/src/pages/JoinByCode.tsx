import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../lib/session";

export function JoinByCode(): ReactNode {
  const { code = "" } = useParams();
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (!loading && user) {
      const t = window.setTimeout(() => navigate(`/room/${code.toUpperCase()}`, { replace: true }), 400);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [loading, user, code, navigate]);

  useEffect(() => {
    if (!loading && !user) {
      const iv = window.setInterval(() => setCountdown((c) => c - 1), 1000);
      return () => window.clearInterval(iv);
    }
    return undefined;
  }, [loading, user]);

  useEffect(() => {
    if (!user && countdown <= 0) {
      navigate("/login", { state: { from: `/join/${code}` } });
    }
  }, [countdown, user, navigate, code]);

  if (loading) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page page-narrow">
        <div className="card" style={{ textAlign: "center" }}>
          <div className="empty-icon" aria-hidden>
            ◈
          </div>
          <h1 style={{ fontSize: "var(--fs-xl)", marginBottom: "var(--sp-3)" }}>
            You've been invited to a Hearth room
          </h1>
          <p className="muted mb-4">
            Room code <strong style={{ color: "var(--amber-300)" }}>{code.toUpperCase()}</strong>. Sign
            in or create a free account to join — taking you there in {Math.max(0, countdown)}s.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link to="/login" className="btn btn-secondary">
              Sign in
            </Link>
            <Link to="/register" className="btn btn-primary">
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
      <span className="spinner" aria-label="Joining room" />
    </div>
  );
}
