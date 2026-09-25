import { Link } from "react-router-dom";
import { useSession } from "../lib/session";

const POINTS = [
  {
    title: "Private rooms, your people",
    body: "Every room holds up to ten friends behind an invite code or link. No public feeds, no strangers unless you bring them.",
  },
  {
    title: "Ten games, one conversation",
    body: "Truth or Dare, collaborative drawing, quick-fire choices, social guessing — each one designed to make you talk, laugh and learn something about each other.",
  },
  {
    title: "Fresh every week",
    body: "The prompt library refreshes automatically every week with thousands of new truths, dares and dilemmas. It never gets stale.",
  },
  {
    title: "Private by design",
    body: "Chats, photos and voice notes stay inside the room. Uploads are validated, stored privately and shared only with people who were there.",
  },
];

export function Landing(): React.ReactNode {
  const { user } = useSession();

  return (
    <div>
      <div className="topnav" style={{ background: "transparent", borderBottom: "none" }}>
        <Link to="/" className="topnav-brand">
          <span aria-hidden>◈</span> Hearth
        </Link>
        <div className="topnav-spacer" />
        <div className="topnav-user">
          {user ? (
            <Link to="/games" className="btn btn-primary btn-sm">
              Open Hearth
            </Link>
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
      </div>

      <header className="hero">
        <h1>Play together. Talk more. Discover each other.</h1>
        <p className="hero-sub">
          Hearth is a set of small multiplayer games built for one purpose: making it easier to
          spend real time with your people — wherever they are.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link to="/games" className="btn btn-primary">
              Open Hearth
            </Link>
          ) : (
            <Link to="/register" className="btn btn-primary">
              Get started — it's free
            </Link>
          )}
          <a href="#how" className="btn btn-ghost">
            How it works
          </a>
        </div>
      </header>

      <section className="landing-band">
        <div className="landing-section">
          <div className="landing-grid">
            {POINTS.map((p) => (
              <div key={p.title} className="landing-point">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="how">
        <div className="page-head">
          <h2 style={{ fontSize: "var(--fs-xl)" }}>How an evening works</h2>
        </div>
        <div className="landing-grid">
          <div className="landing-point">
            <h3>
              <span className="badge badge-accent">1</span> Make a room
            </h3>
            <p>
              Create a private room in one tap and share the code or link with your group. Up to
              ten of you.
            </p>
          </div>
          <div className="landing-point">
            <h3>
              <span className="badge badge-accent">2</span> Pick a game
            </h3>
            <p>
              Browse the shelf: talk-heavy games, creative ones, quick this-or-thats. The host
              chooses; everyone sees it instantly.
            </p>
          </div>
          <div className="landing-point">
            <h3>
              <span className="badge badge-accent">3</span> Play and talk
            </h3>
            <p>
              Chat lives inside the game. Reactions, jokes, voice notes — everything happens in
              the same place, in realtime.
            </p>
          </div>
          <div className="landing-point">
            <h3>
              <span className="badge badge-accent">4</span> Come back next week
            </h3>
            <p>
              Fresh prompts land every week automatically, so the fifth game night feels like the
              first one.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="card" style={{ textAlign: "center", padding: "var(--sp-10)" }}>
          <h2 style={{ fontSize: "var(--fs-xl)", marginBottom: "var(--sp-3)" }}>
            The games are the mechanism. People are the point.
          </h2>
          <p className="muted" style={{ maxWidth: "56ch", margin: "0 auto var(--sp-6)" }}>
            No streaks, no pressure, no dark patterns. Just a well-lit room for you and your
            favorite people.
          </p>
          {user ? (
            <Link to="/games" className="btn btn-primary">
              Open Hearth
            </Link>
          ) : (
            <Link to="/register" className="btn btn-primary">
              Create your room
            </Link>
          )}
        </div>
      </section>

      <footer className="footer">
        Hearth — a social gaming space. Be kind out there. · <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
