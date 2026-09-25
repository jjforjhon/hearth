import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, useLocation, useParams } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { SessionProvider, useSession } from "./lib/session";
import { RoomProvider } from "./lib/room";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Games } from "./pages/Games";
import { Friends } from "./pages/Friends";
import { Profile } from "./pages/Profile";
import { Settings } from "./pages/Settings";
import { Admin } from "./pages/Admin";
import { JoinByCode } from "./pages/JoinByCode";
import { RoomPage } from "./pages/Room";
import { ResetPassword } from "./pages/ResetPassword";
import { ConnectionBanner } from "./components/ConnectionBanner";

function TopNav(): React.ReactNode {
  const { user, loading, logout } = useSession();
  const location = useLocation();

  if (location.pathname.startsWith("/join/") && user) return null; // room has its own chrome
  if (!user && location.pathname === "/") return null; // landing renders its own header

  return (
    <nav className="topnav">
      <Link to={user ? "/games" : "/"} className="topnav-brand">
        <span aria-hidden>◈</span> Hearth
      </Link>
      {user && (
        <div className="topnav-links">
          <NavLink to="/games" className={({ isActive }) => `topnav-link${isActive ? " active" : ""}`}>
            Games
          </NavLink>
          <NavLink to="/friends" className={({ isActive }) => `topnav-link${isActive ? " active" : ""}`}>
            Friends
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => `topnav-link${isActive ? " active" : ""}`}>
            Profile
          </NavLink>
          {user.isPlatformAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `topnav-link${isActive ? " active" : ""}`}>
              Admin
            </NavLink>
          )}
        </div>
      )}
      <div className="topnav-spacer" />
      <div className="topnav-user">
        {loading ? null : user ? (
          <>
            <NavLink to="/settings" className={({ isActive }) => `topnav-link${isActive ? " active" : ""}`}>
              Settings
            </NavLink>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void logout();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/register" className="btn btn-primary btn-sm">
              Create account
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

/** Wraps the room page in its realtime provider, keyed by the :code param. */
function RoomRoute(): React.ReactNode {
  const { code = "" } = useParams();
  return (
    <RoomProvider code={code}>
      <RoomPage />
    </RoomProvider>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }): React.ReactNode {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App(): React.ReactNode {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ConnectionBanner />
        <TopNav />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/join/:code" element={<JoinByCode />} />
          <Route
            path="/games"
            element={
              <RequireAuth>
                <Games />
              </RequireAuth>
            }
          />
          <Route
            path="/friends"
            element={
              <RequireAuth>
                <Friends />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <Admin />
              </RequireAuth>
            }
          />
          <Route
            path="/room/:code"
            element={
              <RequireAuth>
                <RoomRoute />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
