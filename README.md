# Hearth

**Play together. Talk more. Discover each other.**

A multiplayer social gaming platform: private rooms of up to 10 friends, ten realtime
games, and a weekly-refreshing Truth-or-Dare library. The games are the mechanism;
human interaction is the product.

## Quick start

```bash
npm install
npm run dev:server   # API + realtime on :4318
npm run dev:web      # web app on :5173 (proxies /api to :4318)
```

Open http://localhost:5173 — create an account, start a room, share the code.

The server also serves the production build at :4318 after `npm run build:web`.

## What's inside

| Workspace | Purpose |
|---|---|
| `apps/server` | Fastify HTTP API, Socket.IO realtime, game engine, content pipeline (SQLite) |
| `apps/web` | React + Vite client with a hand-rolled design system |
| `packages/shared` | Protocol contract shared by both sides (types + zod schemas) |

Ten games ship out of the box: True or False, Truth or Dare, Draw Together, Co-op
Puzzle, This or That, How Well Do You Know Me?, Word Association, Story Together,
Would You Rather, Guess the Player.

## Documentation

- `docs/ARCHITECTURE.md` — stack decisions, database schema, realtime model, deployment
- `docs/SECURITY.md` — security architecture, **verified** test results, explicit untested gaps
- `docs/ADDING-A-GAME.md` — the GameModule contract and a worked example

## Tests

```bash
# with the dev server running on :4318
cd apps/server
npx tsx test/e2e-flow.ts        # 24 checks — core user journey
npx tsx test/security.ts        # 64 checks — auth abuse, IDOR, fuzzing, rate limits
npx tsx test/realtime.ts        # 29 checks — socket security, capacity, draw sync, 10-player flow
npx tsx test/content-pipeline.ts # 19 checks — weekly content requirement (isolated DB)
npx tsx scripts/verify-cron.ts  # scheduler fires automatically
```

## Configuration

Copy `apps/server/.env.example` to `apps/server/.env.local`. In development, missing
secrets are replaced with ephemeral values (sessions won't survive restarts). In
production, `SESSION_SECRET` and `MEDIA_SIGNING_SECRET` are **required** — the server
refuses to start without them.

## License

MIT — see `LICENSE`.
