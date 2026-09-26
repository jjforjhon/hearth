/**
 * Board & card game test suite — UNO and Ludo end-to-end over the real API:
 * game start with exactly 2 players (the new global minimum), hidden-hand
 * isolation, full UNO game to completion, and a scripted Ludo game to
 * completion. Socket game:state events are buffered from connect time so the
 * initial per-player views are never missed, and completion is detected via
 * the engine's game:completed event (no final game:state is emitted).
 */
import { io, type Socket } from "socket.io-client";

const BASE = "http://localhost:4318";
let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface HttpUser {
  cookie: string;
  userId: string;
  username: string;
}

interface PersonalState {
  sessionId: string;
  // Tests read loosely-typed game views; `any` keeps casts ergonomic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any;
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, {
      extraHeaders: { cookie },
      transports: ["websocket"],
      reconnection: false,
    });
    const t = setTimeout(() => reject(new Error("connect timeout")), 8000);
    s.on("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on("connect_error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function ack<T = { ok: boolean; error?: string }>(s: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    s.timeout(6000).emit(event, payload, (err: unknown, res: T) => {
      resolve((err ? { ok: false, error: "timeout" } : res) as T);
    });
  });
}

interface Standings {
  userId: string;
  displayName: string;
  score: number;
}

/** Buffers game:state + game:completed + game chat events from attach time onward. */
class StateBuf {
  states: PersonalState[] = [];
  completedStandings: Standings[] | null = null;
  chat: string[] = [];
  constructor(sock: Socket) {
    sock.on("game:state", (p: PersonalState) => {
      if (p && p.view) this.states.push(p);
    });
    sock.on("game:completed", (p: { sessionId: string; standings?: Standings[] }) => {
      if (!p.standings?.length) console.log(`  [debug] game:completed with EMPTY standings: ${JSON.stringify(p)}`);
      this.completedStandings = p.standings ?? [];
    });
    sock.on("chat:message", (m: { body?: string; kind?: string }) => {
      if (m?.body) this.chat.push(m.body);
    });
  }
  dump(tag: string): void {
    console.log(`  [debug] ${tag}: states=${this.states.length} completed=${this.completed} chatTail=${JSON.stringify(this.chat.slice(-5))}`);
  }
  get completed(): boolean {
    return this.completedStandings !== null;
  }
  latest(pred: (v: Record<string, unknown>) => boolean): PersonalState | null {
    for (let i = this.states.length - 1; i >= 0; i--) {
      const s = this.states[i]!;
      if (pred(s.view)) return s;
    }
    return null;
  }
  /** Wait for a state matching pred at index >= sinceIndex (fresh only). */
  waitNew(pred: (v: Record<string, unknown>) => boolean, sinceIndex: number, timeoutMs = 6000): Promise<PersonalState | null> {
    const scan = (): PersonalState | null => {
      for (let i = this.states.length - 1; i >= sinceIndex; i--) {
        const s = this.states[i]!;
        if (pred(s.view)) return s;
      }
      return null;
    };
    const found = scan();
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        const hit = scan();
        if (hit || Date.now() - started > timeoutMs) {
          clearInterval(iv);
          resolve(hit);
        }
      }, 60);
    });
  }
  get size(): number {
    return this.states.length;
  }
}

const suffix = Date.now() % 1000000;

async function register(name: string): Promise<HttpUser> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${name}_${suffix}`, email: `${name}_${suffix}@bc.local`, password: "correcthorse9", displayName: name }),
  });
  if (res.status !== 200) throw new Error(`register ${name}: ${res.status}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const j = (await res.json()) as { id: string };
  return { cookie, userId: j.id, username: `${name}_${suffix}` };
}

async function api<T = unknown>(user: HttpUser, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: body === undefined ? (method === "POST" || method === "PATCH" ? "{}" : undefined) : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

interface Room {
  host: HttpUser;
  roomId: string;
  bufs: StateBuf[]; // index 0 = host, then others in join order
  socks: Socket[]; // same order
}

/** Create a room (host), join extra players via code, select + start a game. */
async function setupRoom(gameId: string, others: HttpUser[]): Promise<Room> {
  const host = await register(`bc_${gameId.replace(/[^a-z]/g, "")}${Math.floor(Math.random() * 99)}`);
  const created = await api<{ room: { id: string; code: string } }>(host, "POST", "/api/rooms", { name: `${gameId} test` });
  const roomId = created.json.room.id;
  const code = created.json.room.code;
  const socks: Socket[] = [];
  const bufs: StateBuf[] = [];
  const hostSock = await connect(host.cookie);
  socks.push(hostSock);
  bufs.push(new StateBuf(hostSock));
  await ack(hostSock, "room:join", { code });
  for (const u of others) {
    const s = await connect(u.cookie);
    socks.push(s);
    bufs.push(new StateBuf(s));
    const r = await ack<{ ok: boolean; error?: string }>(s, "room:join", { code });
    if (!r.ok) throw new Error(`join failed: ${r.error}`);
    await api(u, "POST", `/api/rooms/${roomId}/ready`, { ready: true });
  }
  await api(host, "POST", `/api/rooms/${roomId}/ready`, { ready: true });
  await api(host, "POST", `/api/rooms/${roomId}/game`, { gameId });
  const start = await api(host, "POST", `/api/rooms/${roomId}/start`);
  if (start.status !== 200) throw new Error(`start ${gameId}: ${start.status} ${JSON.stringify(start.json)}`);
  return { host, roomId, bufs, socks };
}

interface UnoView {
  players: Array<{ id: string; count: number }>;
  myHand: Array<{ id: string; color: string; value: string }>;
  topCard: { color: string; value: string } | null;
  activeColor: string;
  turnId: string | null;
  isMyTurn: boolean;
  canPassDraw: boolean;
  winnerId: string | null;
}

function playableUno(v: UnoView): UnoView["myHand"][number] | undefined {
  return v.myHand.find(
    (c) => c.color === "wild" || c.color === v.activeColor || (v.topCard !== null && c.value === v.topCard.value && v.topCard.color !== "wild"),
  );
}

function wildColor(n: number): string {
  return ["red", "yellow", "green", "blue"][n % 4]!;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function winnerFromStandings(a: StateBuf, b: StateBuf): string | null {
  // Engine emits raw DB rows (user_id) despite the declared shape — read both.
  const s = (a.completedStandings ?? b.completedStandings) as Array<Record<string, unknown>> | null;
  const first = s?.[0];
  return first ? ((first.userId as string) ?? (first.user_id as string) ?? null) : null;
}

/* ============================ UNO ============================ */
console.log("\n== UNO: 2-player start (new minimum) ==");
{
  const p2 = await register(`bc_uno_p2`);
  const { host, bufs, socks } = await setupRoom("uno", [p2]);
  const hostBuf = bufs[0]!;
  const p2Buf = bufs[1]!;
  const hostSock = socks[0]!;
  const p2Sock = socks[1]!;

  const started = await hostBuf.waitNew((v) => v.kind === "uno", 0);
  check("UNO starts with exactly 2 players", !!started);
  const dealt = await hostBuf.waitNew(
    (v) => v.kind === "uno" && Array.isArray((v as unknown as UnoView).myHand) && (v as unknown as UnoView).myHand.length === 7,
    0,
  );
  check("host dealt 7 cards", !!dealt);
  const p2View = await p2Buf.waitNew((v) => v.kind === "uno" && (v as unknown as UnoView).myHand.length === 7, 0);
  check("second player received their own 7-card view", !!p2View);

  const hv = (dealt?.view ?? {}) as UnoView;
  const pv = (p2View?.view ?? {}) as UnoView;
  check("hands are disjoint between players (no shared card ids)",
    !hv.myHand.some((c) => pv.myHand.some((c2) => c2.id === c.id)));
  check("each player sees both players holding 7", hv.players.every((p) => p.count === 7) && pv.players.every((p) => p.count === 7));

  // Out-of-turn play rejected for whichever player is not on turn.
  {
    const turnId = hv.turnId!;
    const nonTurnSock = turnId === host.userId ? p2Sock : hostSock;
    const nonTurnView = ((turnId === host.userId ? p2Buf : hostBuf).latest((v) => v.kind === "uno")?.view ?? {}) as UnoView;
    const r = await ack(nonTurnSock, "game:action", { action: "play", payload: { cardId: nonTurnView.myHand[0]?.id } });
    check("out-of-turn play rejected", r.ok === false);
  }

  // Drive a full UNO game to completion with scripted legal play.
  let winner: string | null = null;
  let turns = 0;
  let lastError = "";
  while (turns < 300) {
    if (hostBuf.completed || p2Buf.completed) {
      winner = winnerFromStandings(hostBuf, p2Buf);
      break;
    }
    const anyView = hostBuf.latest((v) => v.kind === "uno")?.view as UnoView | undefined;
    if (!anyView) { lastError = "no view"; break; }
    if (anyView.winnerId) { winner = String(anyView.winnerId); break; }
    const turnId = anyView.turnId!;
    const isHost = turnId === host.userId;
    const sock = isHost ? hostSock : p2Sock;
    const buf = isHost ? hostBuf : p2Buf;
    const otherId = isHost ? p2.userId : host.userId;
    const otherBuf = isHost ? p2Buf : hostBuf;
    // Baseline captured BEFORE acting so in-flight advances are never skipped.
    const since = buf.size;
    const mine = buf.latest((v) => v.kind === "uno")?.view as UnoView | undefined;
    if (!mine) { lastError = "actor missing view"; break; }
    if (!mine.isMyTurn) {
      const w = await buf.waitNew((v) => v.kind === "uno" && (v as unknown as UnoView).isMyTurn === true, since, 5000);
      if (!w) { lastError = "turn never arrived"; break; }
      continue;
    }
    turns++;
    const card = playableUno(mine);
    let res: { ok: boolean; error?: string };
    if (card) {
      const payload: Record<string, unknown> = { cardId: card.id };
      if (card.color === "wild") payload.color = wildColor(turns);
      res = await ack(sock, "game:action", { action: "play", payload });
    } else {
      res = await ack(sock, "game:action", { action: "draw" });
    }
    if (!res.ok) {
      // Stale view (turn changed mid-decision): re-poll instead of failing.
      await sleep(150);
      continue;
    }
    if (!card) {
      // Drew: if the drawn card was playable we must play it or pass.
      const av = (await buf.waitNew((v) => v.kind === "uno", since, 4000))?.view as UnoView | undefined;
      if (av?.canPassDraw && av.isMyTurn && !av.winnerId) {
        const drawn = playableUno(av);
        const res2 = drawn
          ? await ack(sock, "game:action", {
              action: "play",
              payload: { cardId: drawn.id, ...(drawn.color === "wild" ? { color: wildColor(turns + 1) } : {}) },
            })
          : await ack(sock, "game:action", { action: "pass" });
        if (!res2.ok) {
          await sleep(150);
          continue;
        }
      }
    }
    // No cross-turn gate: Skip/Draw2 return the turn to the actor in 2-player.
    // The loop re-reads the freshest state each iteration; completion is caught
    // at the top via game:completed.
  }
  if (!winner) hostBuf.dump("UNO end");
  check("UNO game reached completion via scripted play", !!winner, lastError || `turns=${turns}`);
  if (winner) {
    check("UNO winner is a participant", winner === host.userId || winner === p2.userId);
    const standings = hostBuf.completedStandings ?? p2Buf.completedStandings;
    check("UNO standings include both players", !!standings && standings.length === 2);
  }
}

/* ============================ Ludo ============================ */
console.log("\n== Ludo: 2-player start + deterministic run ==");
{
  const p2 = await register(`bc_ludo_p2`);
  const { host, bufs, socks } = await setupRoom("ludo", [p2]);
  const hostBuf = bufs[0]!;
  const p2Buf = bufs[1]!;
  const hostSock = socks[0]!;
  const p2Sock = socks[1]!;

  const started = await hostBuf.waitNew((v) => v.kind === "ludo", 0);
  check("Ludo starts with exactly 2 players", !!started);

  interface LudoView {
    players: Array<{ id: string; color: string; tokensHome: number }>;
    tokens: Record<string, number[]>;
    dice: number | null;
    diceRolled: boolean;
    turnId: string | null;
    isMyTurn: boolean;
    myColor: string | null;
    legalTokens: number[];
    winnerId: string | null;
  }
  const v0 = (started?.view ?? {}) as unknown as LudoView;
  check("two seats assigned (red + yellow)", v0.players?.length === 2 && v0.players.every((p) => p.color === "red" || p.color === "yellow"));
  check("8 tokens start in base", Object.values(v0.tokens ?? {}).every((t) => t.every((p) => p === -1)));

  // Out-of-turn roll rejected.
  {
    const turnId = v0.turnId!;
    const nonTurnSock = turnId === host.userId ? p2Sock : hostSock;
    const r = await ack(nonTurnSock, "game:action", { action: "roll" });
    check("out-of-turn roll rejected", r.ok === false);
  }

  let winner: string | null = null;
  let plies = 0;
  let lastError = "";
  while (plies < 600) {
    if (hostBuf.completed || p2Buf.completed) {
      winner = winnerFromStandings(hostBuf, p2Buf);
      break;
    }
    const view = hostBuf.latest((v) => v.kind === "ludo")?.view as LudoView | undefined;
    if (!view) { lastError = "no view"; break; }
    if (view.winnerId) { winner = String(view.winnerId); break; }
    const turnId = view.turnId!;
    const isHost = turnId === host.userId;
    const sock = isHost ? hostSock : p2Sock;
    const buf = isHost ? hostBuf : p2Buf;
    const since = buf.size;

    if (!view.diceRolled) {
      plies++;
      const roll = await ack(sock, "game:action", { action: "roll" });
      if (!roll.ok) {
        // Stale view (turn changed mid-decision): re-poll instead of failing.
        await sleep(150);
        continue;
      }
      if (hostBuf.completed || p2Buf.completed) continue;
      const after = (await buf.waitNew((v) => {
        const vv = v as unknown as LudoView;
        return vv.winnerId !== null || vv.diceRolled === true || vv.turnId !== turnId;
      }, since, 6000))?.view as LudoView | undefined;
      if (!after) {
        if (hostBuf.completed || p2Buf.completed) continue;
        lastError = "no state after roll";
        break;
      }
      if (after.winnerId) { winner = String(after.winnerId); break; }
      continue; // loop re-reads the freshest view (may be six-reroll or next player)
    }
    // diceRolled: move a legal token (prefer releasing from base, else farthest).
    plies++;
    const cur = (buf.latest((v) => v.kind === "ludo")?.view ?? view) as LudoView;
    if (!cur.legalTokens?.length) {
      // No legal move in this (possibly stale) view: brief settle, then re-poll.
      await sleep(150);
      continue;
    }
    const tokens = cur.tokens[cur.myColor ?? cur.players.find((p) => p.id === turnId)!.color] ?? [];
    const baseIdx = cur.legalTokens.find((i) => tokens[i] === -1);
    const token = baseIdx ?? cur.legalTokens[cur.legalTokens.length - 1]!;
    const mv = await ack(sock, "game:action", { action: "move", payload: { token } });
    if (!mv.ok) {
      await sleep(150);
      continue;
    }
  }
  if (!winner) hostBuf.dump("Ludo end");
  check("Ludo game reached completion via scripted play", !!winner, lastError || `plies=${plies}`);
  if (winner) {
    check("Ludo winner is a participant", winner === host.userId || winner === p2.userId);
    // The winning move emits game:completed (no further game:state), so assert
    // from standings: Ludo score = tokensHome*10 + captures*5 → winner ≥ 40.
    const standings = (hostBuf.completedStandings ?? p2Buf.completedStandings) as Array<Record<string, unknown>> | null;
    const mine = standings?.find((s) => (s.userId ?? s.user_id) === winner);
    check("winner has all 4 tokens home (score ≥ 40)", !!mine && Number(mine.score ?? 0) >= 40, `score=${mine?.score}`);
  }
}

/* ==================== minPlayers metadata ==================== */
console.log("\n== /api/games metadata ==");
{
  const u = await register(`bc_meta`);
  const res = await api<{ games: Array<{ id: string; minPlayers: number; maxPlayers: number }> }>(u, "GET", "/api/games");
  const games = res.json.games ?? [];
  const uno = games.find((g) => g.id === "uno");
  const ludo = games.find((g) => g.id === "ludo");
  check("uno listed with minPlayers 2", !!uno && uno.minPlayers === 2);
  check("ludo listed with minPlayers 2, maxPlayers 4", !!ludo && ludo.minPlayers === 2 && ludo.maxPlayers === 4);
  check("every listed game has minPlayers 2", games.length >= 12 && games.every((g) => g.minPlayers === 2));
}

console.log(`\n(${passes} passed, ${failures} failed)`);
process.exit(failures ? 1 : 0);
