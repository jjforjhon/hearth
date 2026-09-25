# Production Deployment — Hearth ($0/month architecture)

Deployed shape (all free tiers, verified against official docs September 2026):

```
GitHub (source + Actions CI + weekly cron + auto-deploy hook)
   └─▶ Render free web service  — Node 24: Fastify API + Socket.IO + static SPA
         ├─▶ Turso (libSQL)     — persistent cloud database  (5 GB free)
         └─▶ Backblaze B2       — private media bucket       (10 GB free)
```

## Why these providers (verified free-tier facts)

| Service | Free allowance | Renewal | Card required | Sleep behavior | Key risk |
|---|---|---|---|---|---|
| Render web service | 750 instance hrs/mo | monthly | **No** | spins down after 15 min idle (~60s wake — accepted by owner) | bandwidth quota; suspension (not billing) if exceeded without card |
| Turso (libSQL) | 5 GB, 500M row reads, 10M row writes /mo | monthly | **No** | scale-to-zero on idle (not deletion) | quota exhaustion = refused writes until reset |
| Backblaze B2 | 10 GB storage, free egress | ongoing | **No** | n/a | none at hobby scale |
| GitHub Actions | 2,000 min/mo private, unlimited public | monthly | No | scheduled workflows auto-disable after 60 days without commits (mitigated by keepalive commit in the weekly workflow) | cron delay up to ~15 min is possible (best-effort scheduler) |

**Render Postgres is explicitly NOT used** — free databases expire 30 days after creation (verified: render.com/docs/free).

## Architecture decisions

- **Database:** the whole synchronous better-sqlite3 data layer runs unchanged on
  both drivers. `LIBSQL_URL` set → remote libSQL/Turso (production);
  unset → local SQLite file (development). No async rewrite, no ORM, one SQL dialect.
- **Media:** private B2 bucket. Uploads/downloads/deletes are proxied through the
  server (`/api/media/file/:id`) with the existing authorization checks — the
  bucket is never publicly reachable, preserving the verified IDOR guarantees.
  Signed-URL-to-bucket was deliberately rejected for this reason.
- **Weekly scheduler:** GitHub Actions cron ( Sundays 03:00 UTC) →
  `POST /api/admin/cron/weekly` with bearer `HEARTH_CRON_SECRET` (constant-time
  compare, rate-limited 4/h, fails closed when unset). Idempotent per week via
  `weekly_batches.week_key` — duplicate triggers return "already published".
  The workflow also pushes a keepalive commit so GitHub never auto-disables it.
- **Cold starts:** accepted by the owner. The weekly workflow wakes the service
  first (health-probe loop) before triggering the pipeline.
- **PUBLIC_ORIGIN:** auto-derived from `RENDER_EXTERNAL_URL` — zero-config origin,
  same-origin Socket.IO (`io()` with no URL), cookies Secure in production.

## Environment variables (Render dashboard)

| Variable | Source |
|---|---|
| `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` | Turso: `turso db create hearth` → `turso db show hearth --url` / `turso db tokens create hearth` |
| `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME`, `B2_S3_REGION` | Backblaze B2: private bucket + application key limited to it |
| `SESSION_SECRET`, `MEDIA_SIGNING_SECRET`, `HEARTH_CRON_SECRET` | `generateValue: true` in render.yaml (auto-generated) |
| `NODE_ENV=production`, `HEARTH_DISABLE_CRON=1` | fixed in render.yaml |

GitHub repo secrets: `PROD_URL` (https://hearth-xxxx.onrender.com), `HEARTH_CRON_SECRET` (same value as Render's).

## Data migration

The data model is unchanged; schema comes from the same `migrations/*.sql`
applied at boot. To carry existing local data into Turso:
`turso db shell hearth < apps/server/migrations/0001_init.sql` is automatic at
deploy; user data migration (if any) is a `.dump`-based import — performed only
if requested, since the audited test data should not go to production.

## Persistence guarantees

- DB rows: survive redeploys/restarts/spin-downs (Turso, not the container disk).
- Media: survives everything (B2, not the container disk).
- Sessions: DB-backed (sha256-hashed tokens) — survive restarts; 30d TTL / 7d idle.
- Ephemeral disk holds nothing but the (optional, dev-only) SQLite file and node_modules.
