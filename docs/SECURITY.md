# Hearth — Security Model & Verified Test Results

> **Honesty note:** nothing here claims the platform is "secure" in an absolute
> sense. This document records (1) the security architecture as implemented,
> (2) the attack classes that were **actually tested** with automated suites you
> can re-run, and (3) what remains **untested**. Claims without evidence are
> explicitly marked.

## 1. Security architecture

| Layer | Mechanism |
|---|---|
| Passwords | scrypt (N=16384, r=8, p=1, 64-byte key) with per-user random salt; stored as `s1$N$r$p$salt$hash`. Never plaintext. |
| Sessions | Opaque 256-bit tokens; DB stores **sha256(token)** only; HttpOnly + SameSite=Lax cookie (+Secure in production); 30-day TTL, 7-day idle expiry, revocable server-side. |
| AuthZ model | Every HTTP handler and every socket event re-verifies membership/ownership **server-side**; no trusted-client state. Host-only actions enforced in the engine (`handleAction`), not the UI. |
| Input validation | Zod on every HTTP body/params and every socket payload; malformed → 400 with human message (global error handler). |
| SQL injection | All queries are prepared statements with bound parameters; no string-built SQL from user input. |
| XSS | User text stored verbatim in DB, rendered exclusively as React text nodes (no `dangerouslySetInnerHTML` anywhere — verified by grep). |
| CSRF | Cookie is SameSite=Lax + all state changes are POST/PATCH/DELETE with JSON content-type; socket auth uses the cookie but actions are membership-scoped. |
| Media | One-time upload tickets, magic-byte MIME sniffing (declared Content-Type ignored), per-kind size caps, server-generated filenames, private storage dir, HMAC-signed 15-min URLs, membership-checked serving/deletion. |
| Rate limiting | Global 300/min + per-route budgets: login 8/min, register 12/min, password-reset 3/min, media-init 20/min, chat 30/min. |
| Headers | X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy; CSP + HSTS in production. |
| Realtime | Handshake requires a valid session; joins are by code with server-side membership/capacity checks; privileged events verified server-side; unauthenticated sockets rejected. |
| Content pipeline | Zod validation → safety blocklist (hate, self-harm, illegal, explicit, dangerous dares, privacy-invasive, PII, minors) → exact-hash UNIQUE + near-dup shingles (14-day window) → threshold-gated atomic publish. |
| Scheduler | node-cron in-process; run mutex prevents two concurrent pipeline executions; failed runs leave the previous published set untouched. |

## 2. Test suites (all re-runnable)

| Suite | Command | Checks |
|---|---|---|
| E2E flow | `npx tsx test/e2e-flow.ts` (server on :4318) | 24 checks: register/login/logout, room join/view denials, chat, game start, media up/down, admin boundary |
| Security | `npx tsx test/security.ts` | 64 checks: registration abuse, login brute force, session lifecycle/revocation, full IDOR matrix, media IDOR + signed-URL tampering, 18-case input fuzz, rate limits, password reset |
| Realtime | `npx tsx test/realtime.ts` | 29 checks: socket auth, host-privilege attacks, 12-client capacity race, 5-player draw convergence (100 strokes), late-join/reconnect replay, 10-player flow |
| Content pipeline | `npx tsx test/content-pipeline.ts` (isolated DATA_DIR) | 19 checks: full/partial/failure/duplicate/safety/retry/rollback/concurrency |
| Scheduler | `npx tsx scripts/verify-cron.ts` | proves a cron schedule fires automatically |

## 3. Verified attack classes (evidence: suites above, last run all-pass)

- Registration: duplicate email (409), case-variant username (409), malformed email, weak password, no-digit password, 3000-char username — all rejected with 400/409.
- Login: wrong password → generic 401 (same shape as nonexistent account — no enumeration); 12 rapid failures → 429 rate limit.
- Sessions: forged token rejected; logout revokes server-side (old token replay fails); concurrent sessions valid independently; password change revokes other sessions.
- Cross-user (HTTP): user B reading/writing user A's room, chat history, posting, deleting/reacting to A's messages, starting games, kicking, changing settings, transferring host — **all denied**.
- Media: B reading A's media (403), anonymous read (403), B signing/deleting A's media (403), tampered signature (403), expired signature (403), ticket reuse (410), cross-user ticket (403), oversized (413), executable masquerading as image (415).
- Sockets: unauthenticated handshake rejected; forged cookie rejected; non-host kick/start/settings/select/transfer all rejected; forged `subject_answer` rejected; bogus score-granting action rejected; double-vote rejected; actions after leaving rejected.
- Capacity: 12 concurrent join attempts on a 10-slot room → exactly 9 accepted, 3 rejected (atomic transactional check).
- Fuzzing: 18 pathological inputs (empty/null/wrong-type/oversized/SQL/unicode/HTML/extra-fields/pathological IDs) → all 4xx or safely stored; no 500s.
- Draw Together: 5 players × 20 concurrent strokes → 100/100 persisted, all clients converge; late joiner and reconnecting player receive full canvas; undo removes only the actor's stroke.

## 4. Explicitly NOT tested / known gaps

- **AI content provider** (`CONTENT_AI_API_KEY`): interface exists and is exercised via the static provider, but no live AI generation was tested (requires an operator-supplied key). The 3,000–4,000/week sustained target depends on it; the offline static provider yields ~2,100 genuinely-distinct items per batch (verified).
- **Email delivery**: password-reset tokens are logged server-side; no SMTP delivery was tested (no SMTP credentials in this environment).
- **Multi-node deployment**: session store and pipeline mutex assume a single process. Redis-adapter and external cron paths are documented but untested.
- **Load beyond 10 players/room and >~40 concurrent sockets**: not load-tested; no k6/autocannon run.
- **Browser matrix**: visual audit ran in Chromium only; Safari/Firefox untested.
- **Penetration testing**: no external audit; suites above are first-party tests, not an audit substitute.
- **HTTPS**: production headers assume TLS termination by a reverse proxy; not exercised here.
