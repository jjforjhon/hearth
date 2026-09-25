/**
 * Realtime test suite — direct socket attacks + multiplayer behavior.
 * Uses socket.io-client against the running server (:4318).
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

function waitFor<T>(s: Socket, event: string, pred: (p: T) => boolean, timeoutMs = 8000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (p: T): void => {
      if (pred(p)) {
        clearTimeout(timer);
        s.off(event, handler);
        resolve(p);
      }
    };
    s.on(event, handler);
  });
}

const suffix = Date.now() % 1000000;

async function register(name: string): Promise<HttpUser> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${name}_${suffix}`, email: `${name}_${suffix}@rt.local`, password: "correcthorse9", displayName: name }),
  });
  if (res.status !== 200) throw new Error(`register ${name}: ${res.status}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const j = (await res.json()) as { id: string };
  return { cookie, userId: j.id, username: `${name}_${suffix}` };
}

async function makeRoom(u: HttpUser): Promise<{ id: string; code: string }> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: u.cookie },
    body: JSON.stringify({ name: "rt room" }),
  });
  const j = (await res.json()) as { room: { id: string; code: string } };
  return j.room;
}

async function main(): Promise<void> {
  const host = await register("host");
  const p2 = await register("p2");
  const intruder = await register("intruder");

  console.log("\n== S1. Socket authentication ==");
  let unauthRejected = false;
  await new Promise<void>((resolve) => {
    const s = io(BASE, { transports: ["websocket"], reconnection: false, auth: {} });
    s.on("connect_error", () => {
      unauthRejected = true;
      s.close();
      resolve();
    });
    s.on("connect", () => {
      s.close();
      resolve();
    });
    setTimeout(resolve, 6000);
  });
  check("unauthenticated socket handshake rejected", unauthRejected);

  const badCookie = await new Promise<boolean>((resolve) => {
    const s = io(BASE, { extraHeaders: { cookie: "hearth_session=forged" }, transports: ["websocket"], reconnection: false });
    s.on("connect_error", () => {
      s.close();
      resolve(true);
    });
    s.on("connect", () => {
      s.close();
      resolve(false);
    });
    setTimeout(() => resolve(false), 6000);
  });
  check("forged-cookie socket rejected", badCookie);

  console.log("\n== S2. Unauthorized room operations ==");
  const hostRoom = await makeRoom(host);
  const intruderSock = await connect(intruder.cookie);
  const hostSock = await connect(host.cookie);
  const p2Sock = await connect(p2.cookie);

  // intruder tries to join a room they're not in — via direct roomId manipulation is
  // not possible (join is by code), but joining by code then acting must be scoped.
  const joinRes = await ack<{ ok: boolean; roomId?: string }>(hostSock, "room:join", { code: hostRoom.code });
  check("host joins own room via socket", joinRes.ok === true);
  await ack(p2Sock, "room:join", { code: hostRoom.code });

  const intruderJoin = await ack<{ ok: boolean; error?: string }>(intruderSock, "room:join", { code: "ZZZZZZ" });
  check("join with bogus code rejected", intruderJoin.ok === false, JSON.stringify(intruderJoin));

  // Intruder joins the public-by-code room (allowed by design), then tries host actions.
  await ack(intruderSock, "room:join", { code: hostRoom.code });
  const notHostKick = await ack(intruderSock, "room:kick", { userId: host.userId });
  check("non-host kick rejected", notHostKick.ok === false, JSON.stringify(notHostKick));
  const notHostStart = await ack(intruderSock, "room:start", {});
  check("non-host start rejected", notHostStart.ok === false, JSON.stringify(notHostStart));
  const notHostSettings = await ack(intruderSock, "room:settings", { truthFalse: { rounds: 3 } });
  check("non-host settings rejected", notHostSettings.ok === false, JSON.stringify(notHostSettings));
  const notHostSelect = await ack(intruderSock, "room:select_game", { gameId: "truth_false" });
  check("non-host game selection rejected", notHostSelect.ok === false, JSON.stringify(notHostSelect));
  const notHostTransfer = await ack(intruderSock, "room:transfer_host", { userId: intruder.userId });
  check("non-host host-transfer rejected", notHostTransfer.ok === false, JSON.stringify(notHostTransfer));

  console.log("\n== S3. Game-state manipulation ==");
  // Start a truth_false game with 3 players (host + p2 + intruder now in room).
  await fetch(`${BASE}/api/rooms/${hostRoom.id}/game`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: host.cookie },
    body: JSON.stringify({ gameId: "truth_false" }),
  });
  await ack(p2Sock, "room:ready", { ready: true });
  await ack(intruderSock, "room:ready", { ready: true });
  // Register the state listener BEFORE starting so the initial broadcast is captured.
  const statePromise = waitFor<{ view: any }>(hostSock, "game:state", (p) => !!p.view?.current, 8000);
  const startRes = await ack(hostSock, "room:start", {});
  check("host starts game via socket", startRes.ok === true, JSON.stringify(startRes));
  const hs = await statePromise;
  check("host received game state", !!hs);

  const view = hs?.view as any;
  const subjectId = view?.current?.subjectId as string;
  const nonSubject = subjectId === host.userId ? p2 : host;
  const nonSubjectSock = subjectId === host.userId ? p2Sock : hostSock;
  const forgeAnswer = await ack(nonSubjectSock, "game:action", { action: "subject_answer", payload: { choice: "true" } });
  check("subject_answer by non-subject rejected", forgeAnswer.ok === false || !!(forgeAnswer as any).error, JSON.stringify(forgeAnswer));

  // Score manipulation: try a bogus action name and a crafted payload
  const bogus = await ack(p2Sock, "game:action", { action: "grant_self_100_points", payload: { userId: p2.userId, score: 100 } });
  check("bogus privileged action rejected", bogus.ok === false || !!(bogus as any).error, JSON.stringify(bogus));
  const doubleVote = await ack(p2Sock, "game:action", { action: "vote", payload: { choice: "true" } });
  const doubleVote2 = await ack(p2Sock, "game:action", { action: "vote", payload: { choice: "false" } });
  const dv =
    doubleVote.ok !== false ? true : false; // first may fail if p2 is subject; second must fail if first succeeded
  check("double vote rejected", dv === false || doubleVote2.ok === false || !!(doubleVote2 as any).error, `${JSON.stringify(doubleVote)} → ${JSON.stringify(doubleVote2)}`);

  // Non-member cannot act at all: intruder leaves, then tries an action
  await ack(intruderSock, "room:leave");
  const leftAction = await ack(intruderSock, "game:action", { action: "vote", payload: { choice: "true" } });
  check("action after leaving room rejected", leftAction.ok === false || !!(leftAction as any).error, JSON.stringify(leftAction));

  console.log("\n== S4. Room capacity (11th player + race) ==");
  await new Promise((r) => setTimeout(r, 61_000)); // register budget reset
  const capHost = await register("caphost");
  const capRoom = await makeRoom(capHost);
  const capSocks: Socket[] = [];
  const capUsers: HttpUser[] = [];
  capSocks.push(await connect(capHost.cookie));
  await ack(capSocks[0]!, "room:join", { code: capRoom.code });
  // 12 users across two windows so the 12/min register budget isn't exhausted.
  for (let i = 0; i < 6; i++) capUsers.push(await register(`cap${i}`));
  await new Promise((r) => setTimeout(r, 61_000));
  for (let i = 6; i < 12; i++) capUsers.push(await register(`cap${i}`));
  let joined = 0;
  let rejected = 0;
  // Fire all 12 joins concurrently to test the race.
  const results = await Promise.all(
    capUsers.map(async (u) => {
      const s = await connect(u.cookie);
      capSocks.push(s);
      const r = await ack<{ ok: boolean; error?: string }>(s, "room:join", { code: capRoom.code });
      return r.ok === true;
    }),
  );
  for (const ok of results) (ok ? joined++ : rejected++);
  check("11th+ players rejected server-side (exactly 9 of 12 accepted)", joined === 9 && rejected === 3, `joined=${joined} rejected=${rejected}`);
  // Trigger a fresh broadcast (ready toggle) and capture the roster with the
  // listener armed BEFORE the action.
  const rosterPromise = waitFor<any>(capSocks[0]!, "room:view", (v: any) => v?.members?.length >= 10, 6000);
  await ack(capSocks[0]!, "room:ready", { ready: true });
  const finalView = await rosterPromise;
  check("room view shows 10 members max", (finalView?.members?.length ?? 0) === 10, `got ${finalView?.members?.length}`);

  console.log("\n== S5. Draw Together convergence (5 players) ==");
  // New room, select draw_together, everyone joins, each draws strokes.
  const dHost = capUsers[0]!;
  const dRoom = await makeRoom(dHost);
  await fetch(`${BASE}/api/rooms/${dRoom.id}/game`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: dHost.cookie },
    body: JSON.stringify({ gameId: "draw_together" }),
  });
  const dSocks: Socket[] = [await connect(dHost.cookie)];
  await ack(dSocks[0]!, "room:join", { code: dRoom.code });
  for (let i = 1; i < 5; i++) {
    const s = await connect(capUsers[i]!.cookie);
    dSocks.push(s);
    await ack(s, "room:join", { code: dRoom.code });
  }
  await ack(dSocks[0]!, "room:ready", { ready: true });
  for (let i = 1; i < 5; i++) await ack(dSocks[i]!, "room:ready", { ready: true });
  const dStart = await ack(dSocks[0]!, "room:start", {});
  check("draw game started", dStart.ok === true, JSON.stringify(dStart));

  // Each of 5 players draws 20 strokes with 3 points each, concurrently.
  let strokeEventsSeen = 0;
  const allEvents: number[] = [];
  for (const s of dSocks) {
    let count = 0;
    s.on("game:event", (ev: any) => {
      if (ev?.type === "stroke") count++;
    });
    // sample periodically
    const iv = setInterval(() => allEvents.push(count), 500);
    s.on("game:completed", () => clearInterval(iv));
    setTimeout(() => clearInterval(iv), 10000);
  }
  const strokePayload = { color: "#1c1813", width: 4, points: [100, 100, 200, 150, 300, 120], mode: "pen" };
  // Arm the state listener first — each stroke triggers a full state broadcast.
  const strokesPromise = waitFor<{ view: any }>(dSocks[0]!, "game:state", (p) => (p.view?.strokes?.length ?? 0) >= 100, 15000);
  const drawStart = Date.now();
  await Promise.all(
    dSocks.map((s) =>
      Promise.all(Array.from({ length: 20 }, () => ack(s, "game:action", { action: "stroke", payload: { stroke: strokePayload } }))),
    ),
  );
  const drawMs = Date.now() - drawStart;
  const lastState = await strokesPromise;
  const strokeCount = lastState?.view?.strokes?.length ?? 0;
  check("all 100 strokes persisted server-side", strokeCount === 100, `got ${strokeCount}`);
  check("stroke burst completed in reasonable time", drawMs < 20000, `100 strokes in ${drawMs}ms`);

  // Late join receives full canvas — arm BEFORE joining.
  const late = await connect(capUsers[6]!.cookie);
  const latePromise = waitFor<{ view: any }>(late, "game:state", (p) => (p.view?.strokes?.length ?? 0) >= 100, 8000);
  await ack(late, "room:join", { code: dRoom.code });
  const lateState = await latePromise;
  check("late joiner receives full canvas state", (lateState?.view?.strokes?.length ?? 0) === 100, `got ${lateState?.view?.strokes?.length}`);

  // Reconnect: drop a socket, rejoin, receive authoritative state — arm BEFORE joining.
  dSocks[1]!.close();
  await new Promise((r) => setTimeout(r, 500));
  const reconnected = await connect(capUsers[1]!.cookie);
  const rePromise = waitFor<{ view: any }>(reconnected, "game:state", (p) => (p.view?.strokes?.length ?? 0) >= 100, 8000);
  await ack(reconnected, "room:join", { code: dRoom.code });
  const reState = await rePromise;
  check("reconnecting player receives authoritative canvas", (reState?.view?.strokes?.length ?? 0) === 100, `got ${reState?.view?.strokes?.length}`);

  // Undo: only own last stroke removed (state listener armed before the action)
  const undoPromise = waitFor<{ view: any }>(dSocks[0]!, "game:state", (p) => (p.view?.strokes?.length ?? 0) === 99, 8000);
  await ack(dSocks[2]!, "game:action", { action: "undo" });
  const afterUndo = await undoPromise;
  check("undo removes exactly one stroke (own)", (afterUndo?.view?.strokes?.length ?? 0) === 99, `got ${afterUndo?.view?.strokes?.length}`);

  console.log("\n== S6. Ten-player room flow ==");
  // 10-player room: join, chat, ready, start this_or_that, votes, leave, rejoin
  const tHost = capUsers[3]!; // already registered above
  const tRoom = await makeRoom(tHost);
  const tUsers = [tHost, ...capUsers.slice(4, 10), capUsers[0]!, capUsers[1]!, capUsers[2]!].slice(0, 10);
  const tSocks: Socket[] = [];
  // Arm roster listener on the host socket before anyone joins.
  const hostSockT = await connect(tHost.cookie);
  tSocks.push(hostSockT);
  const tenPromiseReal = waitFor<any>(hostSockT, "room:view", (v: any) => v?.members?.length === 10, 15000);
  await ack(hostSockT, "room:join", { code: tRoom.code });
  for (let i = 1; i < tUsers.length; i++) {
    const s = await connect(tUsers[i]!.cookie);
    tSocks.push(s);
    await ack(s, "room:join", { code: tRoom.code });
  }
  const tenView = await tenPromiseReal;
  check("10 players in room", tenView?.members?.length === 10, `got ${tenView?.members?.length}`);

  // chat broadcast
  let chatSeen = 0;
  tSocks[5]!.on("chat:message", () => chatSeen++);
  await fetch(`${BASE}/api/rooms/${tRoom.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: tUsers[0]!.cookie },
    body: JSON.stringify({ body: "hello ten players" }),
  });
  await new Promise((r) => setTimeout(r, 800));
  check("chat broadcast reaches room", chatSeen >= 1, `seen=${chatSeen}`);

  // ready + start this_or_that
  for (let i = 1; i < tSocks.length; i++) await ack(tSocks[i]!, "room:ready", { ready: true });
  await fetch(`${BASE}/api/rooms/${tRoom.id}/game`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: tHost.cookie },
    body: JSON.stringify({ gameId: "this_or_that" }),
  });
  const totPromise = waitFor<{ view: any }>(tSocks[0]!, "game:state", (p) => !!p.view?.current, 8000);
  const tStart = await ack(tSocks[0]!, "room:start", {});
  check("10-player game started", tStart.ok === true, JSON.stringify(tStart));
  const totState = await totPromise;
  check("all players receive round state", !!totState?.view?.current);

  // everyone votes 'a' — final vote triggers the reveal broadcast
  const revealPromise = waitFor<{ view: any }>(tSocks[0]!, "game:state", (p) => p.view?.current?.revealed === true, 8000);
  await Promise.all(tSocks.map((s) => ack(s, "game:action", { action: "vote", payload: { choice: "a" } })));
  const revealed = await revealPromise;
  check("reveal fires after all 10 vote", revealed?.view?.current?.revealed === true, JSON.stringify(revealed?.view?.current?.revealed));

  // leave + rejoin mid-lobby — arm listener before the leave
  const leavePromise = waitFor<any>(tSocks[0]!, "room:view", (v: any) => v?.members?.length === 9, 8000);
  await ack(tSocks[7]!, "room:leave");
  const afterLeave = await leavePromise;
  check("member leave updates roster (9 left)", afterLeave?.members?.length === 9, `got ${afterLeave?.members?.length}`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  console.log(`(${passes} passed, ${failures} failed)`);
  for (const s of [...capSocks, ...dSocks, ...tSocks, hostSock, p2Sock, intruderSock, late, reconnected]) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("realtime test crashed:", err);
  process.exit(1);
});

export {};
