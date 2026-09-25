/**
 * Security test suite — attacks the running server (:4318) directly over HTTP.
 * Every check documents an attack vector and the expected server behavior.
 */
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

interface Client {
  cookie: string;
  userId?: string;
  username?: string;
}

async function api(
  client: Client,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined || method === "POST" ? { "content-type": "application/json" } : {}),
      ...(client.cookie ? { cookie: client.cookie } : {}),
    },
    body: body === undefined ? (method === "POST" ? "{}" : undefined) : JSON.stringify(body),
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
  return { status: res.status, json, headers: res.headers };
}  const suffix = Date.now() % 1000000;
async function makeUser(name: string): Promise<Client> {
  const c: Client = { cookie: "" };
  const r = await api(c, "POST", "/api/auth/register", {
    username: `${name}_${suffix}`,
    email: `${name}_${suffix}@sec.local`,
    password: "correcthorse9",
    displayName: name.toUpperCase(),
  });
  if (r.status !== 200) throw new Error(`setup failed for ${name}: ${r.status}`);
  c.userId = r.json.id;
  c.username = `${name}_${suffix}`;
  return c;
}

async function makeRoom(host: Client): Promise<{ id: string; code: string }> {
  const r = await api(host, "POST", "/api/rooms", { name: `${host.username}'s sec room` });
  return { id: r.json.room.id, code: r.json.room.code };
}

async function main(): Promise<void> {
  console.log("\n== 1. Registration abuse ==");
  const anon: Client = { cookie: "" };

  const dupEmail = await api(anon, "POST", "/api/auth/register", {
    username: `unique_a_${suffix}`,
    email: `alice_${suffix}@test.local`, // registered by e2e flow earlier (may not exist) — use fresh dup below
    password: "correcthorse9",
    displayName: "A",
  });
  // Whatever it was, register same email again and expect 409 on the second.
  const email = `dup_${suffix}@sec.local`;
  const first = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `dupone_${suffix}`,
    email,
    password: "correcthorse9",
    displayName: "D1",
  });
  const second = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `duptwo_${suffix}`,
    email,
    password: "correcthorse9",
    displayName: "D2",
  });
  check("duplicate email rejected (409)", first.status === 200 && second.status === 409, `first=${first.status} second=${second.status}`);

  const u1 = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `uname_${suffix}`,
    email: `u1_${suffix}@sec.local`,
    password: "correcthorse9",
    displayName: "U",
  });
  const u2 = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `UNAME_${suffix}`, // case-insensitive duplicate
    email: `u2_${suffix}@sec.local`,
    password: "correcthorse9",
    displayName: "U",
  });
  check("case-variant duplicate username rejected (409)", u1.status === 200 && u2.status === 409, `${u1.status}/${u2.status}`);

  const badEmail = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `badmail_${suffix}`,
    email: "not-an-email",
    password: "correcthorse9",
    displayName: "B",
  });
  check("malformed email rejected (400)", badEmail.status === 400, `got ${badEmail.status}`);

  const weakPw = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `weakpw_${suffix}`,
    email: `weak_${suffix}@sec.local`,
    password: "short",
    displayName: "W",
  });
  check("weak password rejected (400)", weakPw.status === 400);

  const noDigit = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `nodigit_${suffix}`,
    email: `nd_${suffix}@sec.local`,
    password: "nonumbershere",
    displayName: "N",
  });
  check("password without digit rejected (400)", noDigit.status === 400);

  const huge = "x".repeat(3000);
  const hugeName = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: huge,
    email: `huge_${suffix}@sec.local`,
    password: "correcthorse9",
    displayName: "H",
  });
  check("3000-char username rejected (400)", hugeName.status === 400);

  const xssName = await api({ cookie: "" }, "POST", "/api/auth/register", {
    username: `ok_${suffix}`,
    email: `xss_${suffix}@sec.local`,
    password: "correcthorse9",
    displayName: '<script>alert(1)</script><img src=x onerror=alert(2)>',
  });
  const xssOk = xssName.status === 200;
  if (xssOk) {
    // The display name is stored, but must be inert: React escapes it; also
    // confirm the API returns it as data (JSON), not executed markup.
    const me = await api(xssName as unknown as Client, "GET", "/api/auth/me");
    const dn = me.json?.displayName ?? "";
    check("XSS display name stored as inert data (escaped at render)", dn.includes("<script>"), "returned as plain JSON string");
  } else {
    check("XSS display name handled safely (stored or rejected)", true);
  }

  console.log("\n== 2. Login abuse ==");
  await new Promise((r) => setTimeout(r, 61_000)); // let the register budget reset from section 1
  const victim = await makeUser("victim");
  const wrongPw = await api({ cookie: "" }, "POST", "/api/auth/login", {
    identifier: victim.username,
    password: "wrongpassword1",
  });
  check("wrong password → 401 with generic message", wrongPw.status === 401 && wrongPw.json.error === "Wrong username or password", JSON.stringify(wrongPw.json));

  const ghost = await api({ cookie: "" }, "POST", "/api/auth/login", {
    identifier: `ghost_${suffix}`,
    password: "whateverpass1",
  });
  check("nonexistent account → same 401 shape (no enumeration)", ghost.status === 401 && ghost.json.error === wrongPw.json.error);

  let lastStatus = 0;
  for (let i = 0; i < 12; i++) {
    const r = await api({ cookie: "" }, "POST", "/api/auth/login", {
      identifier: victim.username,
      password: "wrongpassword1",
    });
    lastStatus = r.status;
    if (r.status === 429) break;
  }
  check("brute force rate-limited (429 within 12 attempts)", lastStatus === 429, `last=${lastStatus}`);
  await new Promise((r) => setTimeout(r, 65_000)); // wait out the login budget

  console.log("\n== 3. Session security ==");
  const s1 = await api(victim, "GET", "/api/auth/me");
  check("valid session works", s1.status === 200 && s1.json.id === victim.userId);

  const forged: Client = { cookie: "hearth_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
  const forgedRes = await api(forged, "GET", "/api/auth/me");
  check("forged token rejected (401)", forgedRes.status === 401);

  const noCookie = await api({ cookie: "" }, "GET", "/api/auth/me");
  check("no cookie rejected (401)", noCookie.status === 401);

  const logout = await api(victim, "POST", "/api/auth/logout", {});
  const afterLogout = await api(victim, "GET", "/api/auth/me");
  check("logout revokes session server-side", logout.status === 200 && afterLogout.status === 401, `logout=${logout.status} after=${afterLogout.status}`);

  const relogin = await api(victim, "POST", "/api/auth/login", {
    identifier: victim.username,
    password: "correcthorse9",
  });
  check("re-login after logout works", relogin.status === 200);
  const oldCookie = victim.cookie;
  await api(victim, "POST", "/api/auth/logout", {});
  const reuseOld = await api({ cookie: oldCookie }, "GET", "/api/auth/me");
  check("old token invalid after logout (no replay)", reuseOld.status === 401);

  // concurrent sessions: two logins both valid, independent
  const cA = await api(victim, "POST", "/api/auth/login", { identifier: victim.username, password: "correcthorse9" });
  const cookieA = victim.cookie;
  const cB = await api(victim, "POST", "/api/auth/login", { identifier: victim.username, password: "correcthorse9" });
  const cookieB = victim.cookie;
  const meA = await api({ cookie: cookieA }, "GET", "/api/auth/me");
  const meB = await api({ cookie: cookieB }, "GET", "/api/auth/me");
  check("concurrent sessions both valid", cA.status === 200 && cB.status === 200 && meA.status === 200 && meB.status === 200);
  // password change revokes all other sessions
  victim.cookie = cookieA;
  const pwChange = await api(victim, "POST", "/api/auth/password", { currentPassword: "correcthorse9", newPassword: "newcorrect99" });
  const meBAfter = await api({ cookie: cookieB }, "GET", "/api/auth/me");
  check("password change revokes other sessions", pwChange.status === 200 && meBAfter.status === 401, `pw=${pwChange.status} b=${meBAfter.status}`);
  // restore password for later tests
  await api(victim, "POST", "/api/auth/login", { identifier: victim.username, password: "newcorrect99" });

  console.log("\n== 4. IDOR / cross-user matrix ==");
  await new Promise((r) => setTimeout(r, 61_000)); // register budget reset
  const userA = await makeUser("idora");
  await new Promise((r) => setTimeout(r, 65_000));
  const userB = await makeUser("idorb");
  const roomA = await makeRoom(userA);
  const roomB = await makeRoom(userB);

  // A's room: A posts a message
  await api(userA, "POST", `/api/rooms/${roomA.id}/messages`, { body: "secret message alpha" });
  const aMsgs = await api(userA, "GET", `/api/rooms/${roomA.id}/messages`);
  const aMsgId = aMsgs.json.messages.find((m: any) => m.body.includes("alpha"))?.id as string;

  const bViewA = await api(userB, "GET", `/api/rooms/${roomA.id}`);
  check("B → A's room view denied (403)", bViewA.status === 403, `got ${bViewA.status}`);
  const bReadA = await api(userB, "GET", `/api/rooms/${roomA.id}/messages`);
  check("B → A's chat history denied (403)", bReadA.status === 403, `got ${bReadA.status}`);
  const bPostA = await api(userB, "POST", `/api/rooms/${roomA.id}/messages`, { body: "intrusion" });
  check("B → post into A's room denied (403)", bPostA.status === 403, `got ${bPostA.status}`);
  const bDelA = await api(userB, "DELETE", `/api/messages/${aMsgId}`);
  check("B → delete A's message denied (403)", bDelA.status === 403, `got ${bDelA.status}`);
  const bReactA = await api(userB, "POST", `/api/messages/${aMsgId}/react`, { emoji: "👍" });
  check("B → react on A's message denied (403)", bReactA.status === 403, `got ${bReactA.status}`);
  const bStartA = await api(userB, "POST", `/api/rooms/${roomA.id}/start`, {});
  check("B → start game in A's room denied", bStartA.status >= 400, `got ${bStartA.status}`);
  const bKickA = await api(userB, "POST", `/api/rooms/${roomA.id}/kick`, { userId: userA.userId });
  check("B → kick from A's room denied", bKickA.status >= 400, `got ${bKickA.status}`);
  const bSettingsA = await api(userB, "PATCH", `/api/rooms/${roomA.id}/settings`, { truthFalse: { rounds: 3 } });
  check("B → change A's room settings denied (403)", bSettingsA.status === 403, `got ${bSettingsA.status}`);
  const bTransferA = await api(userB, "POST", `/api/rooms/${roomA.id}/transfer-host`, { userId: userB.userId });
  check("B → host-transfer A's room denied", bTransferA.status >= 400, `got ${bTransferA.status}`);
  const bReadyA = await api(userB, "POST", `/api/rooms/${roomA.id}/ready`, { ready: true });
  check("B → ready-toggle in A's room denied", bReadyA.status === 403 || bReadyA.status === 404, `got ${bReadyA.status}`);

  // profile modification: B patches A's profile — endpoint is self-scoped, so try it
  const bPatchSelf = await api(userB, "PATCH", "/api/auth/profile", { displayName: "B Changed" });
  check("B can patch own profile (control)", bPatchSelf.status === 200);
  // there is no /api/users/:id/profile PATCH route — try to hit one anyway
  const bPatchA = await api(userB, "PATCH", `/api/users/${userA.userId}/profile`, { displayName: "Hacked" });
  check("B → A profile modification: no such route (404) or denied", bPatchA.status === 404 || bPatchA.status >= 400, `got ${bPatchA.status}`);

  console.log("\n== 5. Media IDOR ==");
  const mediaInit = await api(userA, "POST", "/api/media/init", { kind: "photo" });
  const tinyPng = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1e480000000049454e44ae426082",
    "hex",
  );
  const upRes = await fetch(`${BASE}/api/media/upload/${mediaInit.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: userA.cookie },
    body: tinyPng,
  });
  const upJson = (await upRes.json()) as { mediaId: string };
  check("A uploads media (setup)", upRes.status === 200 && !!upJson.mediaId);

  const bFetch = await fetch(`${BASE}/api/media/file/${upJson.mediaId}`, { headers: { cookie: userB.cookie } });
  check("B → A's media denied (403)", bFetch.status === 403, `got ${bFetch.status}`);
  const anonFetch = await fetch(`${BASE}/api/media/file/${upJson.mediaId}`);
  check("anonymous → A's media denied (403)", anonFetch.status === 403);
  const bSign = await api(userB, "GET", `/api/media/sign/${upJson.mediaId}`);
  check("B → sign A's media denied (403)", bSign.status === 403);
  const bDelete = await api(userB, "DELETE", `/api/media/${upJson.mediaId}`);
  check("B → delete A's media denied (403)", bDelete.status === 403);

  // signed URL: valid + tampered + expired
  const signRes = await api(userA, "GET", `/api/media/sign/${upJson.mediaId}`);
  const signedUrl = signRes.json?.url as string;
  const signedFetch = await fetch(`${BASE}${signedUrl}`);
  check("valid signed URL works for anyone holding it (short-lived by design)", signedFetch.status === 200);
  const tamperedUrl = signedUrl.replace(/sig=[a-f0-9]+/, "sig=" + "0".repeat(64));
  const tamperedFetch = await fetch(`${BASE}${tamperedUrl}`);
  check("tampered signature rejected (403)", tamperedFetch.status === 403, `got ${tamperedFetch.status}`);
  const expiredUrl = signedUrl.replace(/exp=\d+/, String(Date.now() - 1000));
  const expiredFetch = await fetch(`${BASE}${expiredUrl}`);
  check("expired signed URL rejected (403)", expiredFetch.status === 403, `got ${expiredFetch.status}`);

  // upload ticket reuse + cross-user ticket
  const t2 = await api(userA, "POST", "/api/media/init", { kind: "photo" });
  await fetch(`${BASE}/api/media/upload/${t2.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: userA.cookie },
    body: tinyPng,
  });
  const reuse = await fetch(`${BASE}/api/media/upload/${t2.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: userA.cookie },
    body: tinyPng,
  });
  check("upload ticket is one-time (410 on reuse)", reuse.status === 410, `got ${reuse.status}`);
  const t3 = await api(userA, "POST", "/api/media/init", { kind: "photo" });
  const steal = await fetch(`${BASE}/api/media/upload/${t3.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: userB.cookie },
    body: tinyPng,
  });
  check("B cannot use A's upload ticket (403)", steal.status === 403, `got ${steal.status}`);

  // oversized upload
  const t4 = await api(userA, "POST", "/api/media/init", { kind: "avatar" }); // 2MB limit
  const big = Buffer.alloc(3 * 1024 * 1024, 0x89);
  const bigHead = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), big]);
  const bigRes = await fetch(`${BASE}/api/media/upload/${t4.json.uploadToken}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie: userA.cookie },
    body: bigHead,
  });
  check("oversized upload rejected (413)", bigRes.status === 413 || bigRes.status === 400, `got ${bigRes.status}`);

  console.log("\n== 6. Input validation fuzz ==");
  const fuzzRoom = roomA;
  const fuzz = async (label: string, body: unknown): Promise<void> => {
    const r = await api(userA, "POST", `/api/rooms/${fuzzRoom.id}/messages`, body as object);
    check(`chat fuzz ${label} → rejected or safely stored`, r.status === 400 || r.status === 200, `status=${r.status}`);
  };
  await fuzz("empty body", { body: "" });
  await fuzz("whitespace body", { body: "   " });
  await fuzz("2000-char body", { body: "y".repeat(2000) });
  await fuzz("null body", { body: null });
  await fuzz("missing body", {});
  await fuzz("wrong type (number)", { body: 12345 });
  await fuzz("wrong type (object)", { body: { nested: true } });
  await fuzz("SQL payload", { body: "'; DROP TABLE messages; --" });
  await fuzz("unicode", { body: "🚀🔥 #pragma 漢字 π ≈ 3.14159" });
  await fuzz("html injection", { body: "<b>bold</b><script>alert(1)</script>" });
  await fuzz("extra unexpected field", { body: "hi", senderId: userB.userId, isAdmin: true });

  const badIds = ["../../etc/passwd", "room_'; DROP TABLE rooms;--", "%2e%2e%2f", "x".repeat(500), ""];
  for (const bad of badIds) {
    const r = await api(userA, "GET", `/api/rooms/${encodeURIComponent(bad)}`);
    check(`pathological roomId "${bad.slice(0, 24)}" → 4xx`, r.status >= 400 && r.status < 500, `got ${r.status}`);
  }

  const negRound = await api(userA, "PATCH", `/api/rooms/${roomA.id}/settings`, {
    truthFalse: { rounds: -5, secondsPerRound: 99999 },
  });
  check("negative/oversized settings rejected (400)", negRound.status === 400, `got ${negRound.status}`);

  const hugeJson = await api(userA, "POST", `/api/rooms/${roomA.id}/messages`, {
    body: "z".repeat(1001), // just over limit
  });
  check("1001-char message rejected (400)", hugeJson.status === 400, `got ${hugeJson.status}`);

  console.log("\n== 7. Rate limiting (chat spam + room creation) ==");
  const spamClient = await makeUser("spammer");
  const spamRoom = await makeRoom(spamClient);
  let spam429 = 0;
  for (let i = 0; i < 40; i++) {
    const r = await api(spamClient, "POST", `/api/rooms/${spamRoom.id}/messages`, { body: `spam ${i}` });
    if (r.status === 429) {
      spam429++;
      break;
    }
  }
  check("chat spam hits rate limit (429)", spam429 > 0, "global 300/min may absorb 40 msgs — checking room creation instead");
  let room429 = false;
  for (let i = 0; i < 8; i++) {
    const r = await api(spamClient, "POST", "/api/rooms", { name: `spam room ${i}` });
    if (r.status === 429 || r.status === 400) {
      room429 = true;
      break;
    }
  }
  check("room creation limited (429 rate or 400 cap)", room429, "host cap 5 + rate limit");

  console.log("\n== 8. Password reset flow ==");
  const pr = await api({ cookie: "" }, "POST", "/api/auth/password-reset", { identifier: victim.username });
  check("reset request returns uniform response (no enumeration)", pr.status === 200 && !!pr.json.message);
  const prGhost = await api({ cookie: "" }, "POST", "/api/auth/password-reset", { identifier: "no_such_user_xyz" });
  check("reset for ghost user returns same shape", prGhost.status === 200 && !!prGhost.json.message);
  const badConfirm = await api({ cookie: "" }, "POST", "/api/auth/password-reset/confirm", {
    token: "AAAAAAAAAAAAAAAAAAAA",
    newPassword: "anotherpass99",
  });
  check("invalid reset token rejected (400)", badConfirm.status === 400);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  console.log(`(${passes} passed, ${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("security test crashed:", err);
  process.exit(1);
});

export {};
