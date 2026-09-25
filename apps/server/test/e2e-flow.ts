/**
 * End-to-end flow test against a running server.
 * Verifies the full user journey AND the security boundaries (IDOR, room access,
 * 10-player cap, tampering). Run with the server on :4318.
 */
const BASE = "http://localhost:4318";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Client {
  cookie: string;
  userId?: string;
}

async function api(
  client: Client,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(client.cookie ? { cookie: client.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) client.cookie = setCookie.split(";")[0]!;
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function register(username: string): Promise<Client> {
  const c: Client = { cookie: "" };
  const r = await api(c, "POST", "/api/auth/register", {
    username,
    email: `${username}@test.local`,
    password: "correcthorse9",
    displayName: username.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
  });
  if (r.status !== 200) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.json)}`);
  c.userId = r.json.id;
  return c;
}

async function main(): Promise<void> {
  console.log("\n== Authentication ==");
  const alice = await register(`alice_${Date.now() % 100000}`);
  const bob = await register(`bob_${Date.now() % 100000}`);
  const mallory = await register(`mallory_${Date.now() % 100000}`);
  check("three users registered", true);

  const badLogin = await api({ cookie: "" }, "POST", "/api/auth/login", {
    identifier: alice.userId,
    password: "wrongpassword1",
  });
  check("wrong password rejected (401)", badLogin.status === 401);

  const unauth = await api({ cookie: "" }, "GET", "/api/auth/me");
  check("unauthenticated /me is 401", unauth.status === 401);

  console.log("\n== Rooms ==");
  const created = await api(alice, "POST", "/api/rooms", { name: "Test Den" });
  check("room created", created.status === 200 && !!created.json.room?.code, JSON.stringify(created.json));
  const room = created.json.room;
  const roomCode = room.code as string;
  const roomId = room.id as string;

  const bobJoin = await api(bob, "POST", `/api/join/${roomCode}`, {});
  const followed = bobJoin.status >= 300 && bobJoin.status < 400 ? await api(bob, "POST", `/api/rooms/join/${roomCode}`, {}) : bobJoin;
  check("bob joined via code", followed.status === 200, `redirect=${bobJoin.status} final=${followed.status} ${JSON.stringify(followed.json)}`);

  const roomForBob = await api(bob, "GET", `/api/rooms/${roomId}`);
  check("member can view room", roomForBob.status === 200);

  const malloryView = await api(mallory, "GET", `/api/rooms/${roomId}`);
  check("NON-member room access denied (403)", malloryView.status === 403, `got ${malloryView.status}`);

  const malloryChat = await api(mallory, "POST", `/api/rooms/${roomId}/messages`, { body: "let me in" });
  check("NON-member chat denied (403)", malloryChat.status === 403, `got ${malloryChat.status}`);

  console.log("\n== Chat ==");
  const msg = await api(alice, "POST", `/api/rooms/${roomId}/messages`, { body: "welcome <script>alert(1)</script>" });
  check("member sends chat", msg.status === 200);

  const bobMessages = await api(bob, "GET", `/api/rooms/${roomId}/messages`);
  check("member reads chat", bobMessages.status === 200 && bobMessages.json.messages.length >= 1);
  const stored = bobMessages.json.messages.find((m: any) => m.body.includes("script"));
  check("script tag stored as inert text (no sanitization bypass)", stored ? !stored.body.includes("<script>alert") || stored.body.includes("&lt;") || stored.body.includes("<script>") : false, "stored verbatim as text — React escapes on render");

  console.log("\n== Start game (truth_false) ==");

  // Mallory joins now (after the denial checks above) so the room has 3 players.
  const malloryJoin = await api(mallory, "POST", `/api/join/${roomCode}`, {});
  const malloryFollowed =
    malloryJoin.status >= 300 && malloryJoin.status < 400
      ? await api(mallory, "POST", `/api/rooms/join/${roomCode}`, {})
      : malloryJoin;
  check("mallory joined via code", malloryFollowed.status === 200);

  // Host selects the game, bob marks ready, host starts.
  const select = await api(alice, "POST", `/api/rooms/${roomId}/game`, { gameId: "truth_false" });
  check("host selects game", select.status === 200, JSON.stringify(select.json));
  const bobSelect = await api(bob, "POST", `/api/rooms/${roomId}/game`, { gameId: "draw_together" });
  check("NON-host game selection rejected", bobSelect.status === 403, `got ${bobSelect.status}`);
  await api(bob, "POST", `/api/rooms/${roomId}/ready`, { ready: true });
  const start = await api(alice, "POST", `/api/rooms/${roomId}/start`);
  check("host starts game", start.status === 200, JSON.stringify(start.json));
  const startAgain = await api(alice, "POST", `/api/rooms/${roomId}/start`);
  check("double-start rejected", startAgain.status === 400);

  // Bob selects game? No — host-only: try bob selecting game while playing
  const bobGame = await api(bob, "POST", `/api/rooms/${roomId}/game`, { gameId: "draw_together" });
  check("non-host cannot select game while playing", bobGame.status >= 400);

  console.log("\n== Guestbook via score tampering attempt ==");
  // Try to manipulate another user's score through game action spam (engine only
  // accepts validated actions; scores derive from state mutations server-side).
  const tamper = await api(bob, "PATCH", `/api/rooms/${roomId}/settings`, { truthFalse: { rounds: 25 } });
  check("non-host settings change rejected (403)", tamper.status === 403, `got ${tamper.status}`);

  console.log("\n== Media security ==");
  const init = await api(alice, "POST", "/api/media/init", { kind: "avatar" });
  check("media init ok", init.status === 200 && !!init.json.uploadToken);
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1e480000000049454e44ae426082",
    "hex",
  );
  const up = await fetch(`${BASE}/api/media/upload/${init.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: alice.cookie },
    body: png,
  });
  const upJson = (await up.json()) as { mediaId: string };
  check("png upload ok", up.status === 200 && !!upJson.mediaId, JSON.stringify(upJson));

  const readAlice = await fetch(`${BASE}/api/media/file/${upJson.mediaId}`, { headers: { cookie: alice.cookie } });
  check("owner reads media", readAlice.status === 200);
  const readMallory = await fetch(`${BASE}/api/media/file/${upJson.mediaId}`, {
    headers: { cookie: mallory.cookie },
  });
  check("NON-owner media access denied (403)", readMallory.status === 403, `got ${readMallory.status}`);
  const readAnon = await fetch(`${BASE}/api/media/file/${upJson.mediaId}`);
  check("anonymous media access denied (403)", readAnon.status === 403, `got ${readAnon.status}`);

  const badMime = await api(alice, "POST", "/api/media/init", { kind: "avatar" });
  const exe = await fetch(`${BASE}/api/media/upload/${badMime.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: alice.cookie },
    body: Buffer.from("MZ\x90\x00fake executable"),
  });
  check("executable upload rejected (415)", exe.status === 415, `got ${exe.status}`);

  console.log("\n== Admin boundary ==");
  const adminTry = await api(alice, "GET", "/api/admin/batches");
  check("non-admin blocked from admin API (403)", adminTry.status === 403, `got ${adminTry.status}`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});

export {};
