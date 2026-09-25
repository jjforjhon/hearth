# Adding a new game

The platform was built so that game #11 is a new module, not a refactor.

## The contract

Every game implements `GameModule<S>` from `packages/shared/src/games.ts`:

```ts
interface GameModule<S extends BaseGameState> {
  id: GameId;
  name: string; tagline: string; description: string;
  minPlayers: number; maxPlayers: number; approxMinutes: number; style: string;
  actionSchema: z.ZodTypeAny;                  // payload validation for game:action
  createState(ctx: { playerIds: string[]; settings: RoomSettings }): S;
  onAction(state: S, ctx: { userId: string; payload: unknown; playerIds: string[]; settings: RoomSettings; now: number }): GameEffect<S>;
  tick?(state: S, ctx: { playerIds: string[]; settings: RoomSettings; now: number }): GameEffect<S> | null;
  onPlayerLeft?(state: S, userId: string, ctx: { playerIds: string[] }): GameEffect<S> | null;
  scoreSummary(state: S): Array<{ userId: string; displayName: string; score: number }>;
  view(state: S, userId: string | null, extras: GameViewExtras): Record<string, unknown>;
}
```

The engine owns everything else: membership checks, transactions, timers, event
fanout, per-player `view()` projection (hidden info never leaves the server for the
wrong player), score persistence, and completion.

`GameEffect<S>` can return:
- `state` (required) — new authoritative state
- `systemMessages` — appended to the session's game chat
- `broadcastEvents` — verbatim room broadcasts (e.g. incremental draw strokes)
- `completed: true` — engine finalizes scores and returns the room to lobby

## Worked example: "Countdown" (a 30-second guessing game)

**1. Server module** — `apps/server/src/games/countdown.ts`:

```ts
export interface CountdownState extends BaseGameState {
  status: "active" | "completed";
  round: number;
  current: { target: number; guesses: Record<string, number>; revealed: boolean; deadline: number } | null;
  scores: Record<string, number>;
}

export const countdownGame: GameModule<CountdownState> = {
  id: "countdown",
  name: "Countdown",
  // ...
  actionSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("guess"), value: z.number().int().min(0).max(100) }),
    z.object({ action: z.literal("next") }),
  ]),
  onAction(state, ctx) { /* validate caller, mutate a CLONE of state, return effects */ },
  view(state, userId) { /* strip other players' unrevealed guesses */ },
};
```

Rules the engine enforces for you (don't re-check): the caller is an authenticated
room member and the game is active. Rules YOU must enforce in `onAction`: turn order,
one-guess-per-player, hidden information, completion conditions. Always mutate a
`structuredClone` of state and never trust `payload` beyond `actionSchema`.

**2. Register** — two lines in `packages/shared/src/index.ts` (add the id to
`GAME_IDS`) and one line in `apps/server/src/games/registry.ts`.

**3. Client UI** — `apps/web/src/games/Countdown.tsx` consuming `useRoom()`:
`gameState` is your `view()` output; `gameAction(action, payload)` sends validated
actions. Then one import + one `case` in `apps/web/src/components/GameStage.tsx`.

**4. Test** — extend `apps/server/test/realtime.ts` with a section following S6
(join → ready → start → actions → completion). If the game draws from a content
pool, seed it in `apps/server/src/content/seed-other.ts` (hash-dedup is automatic).

## Content pools

If your game needs prompts, store them as `content_items` rows (kind/publish/status
lifecycle is shared) and sample via `sampleGenericContent(kind, category, count, excludeIds)`.
The safety filter and admin moderation apply to your pool for free.
