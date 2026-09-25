# Hearth — Architecture

> **Play together. Talk more. Discover each other.**
> A multiplayer social gaming platform: private rooms of up to 10 players, ten realtime
> games, and a weekly-refreshing Truth-or-Dare content library — built so that *human
> interaction is the product and the games are the mechanism*.

This document records the decisions and constraints a future developer needs in order to
understand, run, extend, and deploy the platform. Pair it with `docs/SECURITY.md` (threat
model + verified test results) and `docs/ADDING-A-GAME.md` (game plugin guide).

---

## 1. Product shape

- Accounts + profiles, friends, notifications, reports/blocks, admin moderation.
- Private rooms (code + invite link, host, ready state, kick, host transfer), hard cap 10 players **enforced server-side**.
- Realtime multiplayer via one Socket.IO namespace, server-authoritative rooms.
- Ten games behind a common `GameModule` plugin interface; adding game #11 is a new module + registry line, not a platform rewrite.
- Weekly content pipeline: generation → validation → safety filter → dedup → categorize → publish, with rollback and an always-present fallback pool.

---

## 2. Technology stack and why

| Layer | Choice | Why (and what was rejected) |
|---|---|---|
| Runtime | Node.js ≥ 22, TypeScript strict everywhere | One language across HTTP, WS and tooling; strict types catch protocol drift. |
| Monorepo | npm workspaces (`apps/server`, `apps/web`, `packages/shared`) | Simplest tooling with zero extra daemons; shared package holds events/schemas so client and server cannot drift. pnpm/bun not installed on this machine. |
| HTTP | Fastify | Fast, schema-friendly, mature plugin model. Express rejected: slower, older middleware pattern. |
| Realtime | Socket.IO over a single namespace | Rooms, acks, automatic reconnect + buffering fit 10-player games well. Raw WS rejected: we'd reimplement reconnect/ack logic. Firebase/Supabase rejected: external auth boundary we can't fully audit and cost at scale; also keeps the whole stack self-hostable. |
| DB | SQLite via better-sqlite3, WAL mode, foreign_keys ON | Zero external services for local dev and small deployments; synchronous transactions are a perfect fit for game-state transitions (no race windows between read and write). Postgres+RLS documented as the scale path; the data layer is isolated so the swap is mechanical. |
| Auth | scrypt (Node core) + opaque 256-bit session tokens stored **hashed** in HttpOnly SameSite=Lax cookies | Revocable sessions, no JWT-in-localStorage theft class, no external auth provider dependency. Password reset flow is email-token based (token hashed at rest). |
| Validation | Zod on **every** HTTP body and **every** socket event | Never trust the client; one schema per message, shared with the client for form validation. |
| Web | React 18 + Vite + vanilla-CSS design system (CSS custom properties, no Tailwind) | Hand-built token system per §3 requirements; avoids generic template look. Vite 6 pinned until node version verification for Vite 7. |
| Scheduler | node-cron in-process | Weekly publish runs inside the server process; documented scale-out path uses a single leader or external cron hitting an authenticated internal endpoint. |
| AI content | Optional provider behind an interface (`ContentProvider`); `StaticContentProvider` always available | If no key configured, pipeline ingests from the curated seed library; keys only ever exist in server env, never shipped to the client. |

### Scale-out path (documented, not implemented)
1. SQLite → Postgres (swap `packages/server-db` — the query layer is the only SQL in the repo).
2. Socket.IO → add Redis adapter for multi-node broadcast.
3. Sessions: table already supports multi-node (token hash lookup is stateless).
4. Scheduler: move cron to external trigger calling `POST /internal/cron/publish` with a shared secret.

---

## 3. Design system

Tokens (color, spacing, type scale, radii, shadows, motion) live in
`apps/web/src/styles/tokens.css`; components in `styles/components.css`. Deliberate
choices: warm paper-white surfaces on a deep neutral ink base, one accent hue
(kinetic amber) reserved for interactive/affirmative actions, calm durations
(120–260 ms) with `prefers-reduced-motion` respected globally. No glassmorphism, no
neon, no gratuitous gradients — the visual identity is typographic hierarchy, spacing
and a single accent.

---

## 4. Realtime model

Single namespace `/`. Client→server events are **only** `game:action`, `chat:send`,
`chat:react`, `chat:typing`, `room:leave`, `room:kick`, `room:transfer_host`,
`room:ready`, `room:select_game`, `room:start`, `room:settings`, `media:request_upload`.
Everything else — state, turns, scores, reveals, membership — is computed and
broadcast **by the server**. Every event payload is zod-validated; every room-scoped
event re-verifies membership inside the handler (no cached "trusted" sets).

Realtime authorization: joining a socket room requires an authenticated user and a
`room_members` row. Presence (join/leave) is derived from socket connects/disconnects,
with a 60 s grace period before `player_left` is emitted so refreshes don't churn the
roster. 

Event names are documented in `packages/shared/src/protocol.ts`.

---

## 5. Database

SQLite schema (see `packages/server-db/migrations/0001_init.sql` in-tree):
users, profiles (display_name, bio, avatar_media_id), sessions, friendships (bidirectional pairs, unique),
friend_requests, rooms (code unique, host, game, status), room_members (role, ready, joined_at, unique),
game_sessions (room, game_id, status, state JSON), game_players (session, user, score),
game_events (append-only audit trail), messages (room, session, sender, kind, body, deleted),
message_reactions, media (kind, mime, size, sha256, storage_path, visibility, uploaded_by),
weekly_batches, content_items (truth/dare library with category/difficulty/language/status),
reports, blocks, notifications, achievements (per user), audit_log, otp_tokens,
password_reset_tokens, platform_settings.

Key integrity rules: `unique(room_id, user_id)` on room_members; `unique(session_id, user_id)`
on game_players; FKs with ON DELETE CASCADE where child rows are meaningless alone; indices on
every FK and on hot lookups (messages by room+created_at, content by status+category).

State in `game_sessions.state` is authoritative JSON written only by the owning
`GameModule` through the engine — clients never write state directly.

---

## 6. Game plugin architecture

Every game implements `GameModule<S>` (interface in `packages/shared/src/games.ts`):

```text
metadata        id, name, tagline, playerRange, duration, style
createState()   initial state for a session
onPlayerJoin/Leave/Kicked   roster changes mid-game
onAction()      validate + apply a player action, mutate state, return events
tick()          advance timers/turns when called by the engine
scoreSummary()  final standings
view(state, userId)  per-player projection (hides hidden info)
```

The engine owns: membership checks, timers, event fanout, persistence, audit trail,
per-player `view()` projections, and the client-side React context that any game UI
plugs into. A new game = one server module + one registry entry + one client component;
no platform code changes. See `docs/ADDING-A-GAME.md`.

Games shipped: truth_false, truth_or_dare, draw_together, coop_puzzle, this_or_that,
know_me, word_association, story_together, would_you_rather, guess_the_player.

---

## 7. Weekly content pipeline

`apps/server/src/content/` implements:

```
node-cron (configurable schedule, default Sun 03:00)
  → ContentProvider.generate(3000–4000 items, categories, difficulties)
  → validate (schema, length, language sanity)
  → safety filter (blocklist: slurs, self-harm, illegal, explicit, PII-harvesting, minors)
  → dedup (exact sha256 + normalized near-dup via shingling)
  → categorize/difficulty tagging
  → write batch row (status=generating → validating → ready)
  → publish (atomic flip of published_set pointer, previous set stays live on any failure)
```

Failure behavior: any exception or failed validation aborts publish; last good set
remains active. `StaticContentProvider` guarantees the library never runs dry. Admin UI
lists batches, allows rollback/regenerate/disable-item.

---

## 8. Media

Uploads go `client → POST /api/media/init` (validated) → server-issued one-time upload
token → `PUT /api/media/upload/:token` (streamed to private dir) → media row created with
sha256, mime, size, visibility. Serving uses short-lived signed URLs
(`/api/media/file/:id?sig=…&exp=…`, HMAC-signed, expiry ≤ 15 min) only for members
entitled to see it. Raw storage is never web-served; MIME is sniffed from magic bytes for
image/audio/video, size capped per kind, filename generated server-side (no user input).

---

## 9. Deployment

Single process: Fastify serves `/api/*`, Socket.IO, static build of `apps/web`, and the
scheduler. Recommended hosting: one small Linux VM/container + volume for SQLite and
media; TLS terminated by reverse proxy (Caddy/nginx) or platform. Secrets via env only
(see `.env.example`). CI: typecheck + tests before any deploy.

---

## 10. Cost profile

Free-tier-friendly: one small VM (~$5) or Fly.io/Render free instance; SQLite file +
local media dir; no external services. Limits to watch at growth: SQLite write
throughput (~10s of writes/sec fine for this workload), single-node realtime (Redis
adapter when >1 node), media disk growth, cron inside process (move to external trigger
when multi-node).
