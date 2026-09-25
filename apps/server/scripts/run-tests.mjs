/**
 * Test runner: for each suite, boots a FRESH API server instance on a local
 * SQLite database (never Turso — tests must not touch production data), waits
 * for /api/health, runs the suite, then tears the server down. Per-suite
 * isolation prevents rate-limit bleed and shared-state coupling.
 *
 * The server and suites are spawned as DIRECT node children (tsx CLI), never
 * through npm/.cmd shims, so teardown owns the real PID on every OS.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd(); // apps/server
const PORT = 4318;
const SUITES = ["security", "e2e-flow", "realtime", "content-pipeline"];

const req = createRequire(path.join(ROOT, "package.json"));
const tsxCli = path.join(path.dirname(req.resolve("tsx/package.json")), "dist", "cli.mjs");

function pipe(proc, label) {
  proc.stdout.on("data", (d) => process.stdout.write(d.toString().replace(/^/gm, `  ${label} `)));
  proc.stderr.on("data", (d) => process.stderr.write(d.toString().replace(/^/gm, `  ${label} `)));
}

function portOccupantPidWindows() {
  // Returns the PID listening on :4318 (win32) or null.
  try {
    const out = require("node:child_process")
      .execSync(`netstat -ano | findstr ":${PORT}" | findstr LISTENING`, { encoding: "utf8" });
    const pid = out.trim().split(/\s+/).pop();
    return pid && /^\d+$/.test(pid) ? pid : null;
  } catch {
    return null; // findstr exits 1 when nothing matches
  }
}

async function ensurePortFree() {
  if (process.platform !== "win32") return; // CI runners are single-purpose Linux boxes
  for (let i = 0; i < 5; i++) {
    const pid = portOccupantPidWindows();
    if (!pid) return;
    console.log(`[runner] port ${PORT} held by PID ${pid} — killing stale server`);
    try {
      require("node:child_process").execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const probe = () => {
      const r = http.get(`http://localhost:${PORT}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      r.on("error", () => retry(resolve));
      r.setTimeout(2000, () => { r.destroy(); retry(resolve); });
    };
    const retry = (resolve) => {
      if (Date.now() > deadline) resolve(false);
      else setTimeout(probe, 1000);
    };
    probe();
  });
}

async function killTree(proc) {
  try { proc.kill("SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 700));
  try { proc.kill("SIGKILL"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
}

let exitCode = 0;
const failed = [];

// The security suite ASSERTS the production rate limits (brute force → 429,
// chat spam → 429), so it must run with pure defaults. Suites that only
// exercise happy paths from a single loopback IP get raised caps here.
const RATE_OVERRIDES = {
  "e2e-flow": { RATE_LIMIT_MAX: "100000", RATE_LIMIT_CHAT_MAX: "100000" },
};

for (const suite of SUITES) {
  console.log(`\n[runner] === suite: ${suite} ===`);
  await ensurePortFree();
  const dataDir = path.join(os.tmpdir(), `hearth-test-${suite}-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });

  const server = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      LIBSQL_URL: "", // force local SQLite — tests must never write to Turso
      LIBSQL_AUTH_TOKEN: "",
      HEARTH_DISABLE_CRON: "1",
      PORT: String(PORT),
      PUBLIC_ORIGIN: `http://localhost:${PORT}`,
      ...RATE_OVERRIDES[suite],
      SESSION_SECRET: "test-secret-0000000000000000000000000000",
      MEDIA_SIGNING_SECRET: "test-signing-000000000000000000000000000",
      HEARTH_CRON_SECRET: "test-cron-000000000000000000000000000000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipe(server, "[server]");

  try {
    const healthy = await waitForHealth();
    if (!healthy) throw new Error("server did not become healthy within 90s");

    const suiteProc = spawn(process.execPath, [tsxCli, `test/${suite}.ts`], {
      cwd: ROOT,
      env: { ...process.env, BASE: `http://localhost:${PORT}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const code = await new Promise((resolve) => {
      pipe(suiteProc, `[${suite}]`);
      suiteProc.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`exited with code ${code}`);
    console.log(`[runner] ${suite}: PASS`);
  } catch (err) {
    console.error(`[runner] ${suite}: FAILED — ${err.message}`);
    failed.push(suite);
    exitCode = 1;
  } finally {
    await killTree(server);
    if (process.platform === "win32") {
      // If the direct child somehow survived, make sure the port is released.
      const pid = portOccupantPidWindows();
      if (pid) {
        try { require("node:child_process").execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch {}
      }
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

if (exitCode === 0) console.log("\n[runner] ALL SUITES PASSED");
else console.error(`\n[runner] FAILED SUITES: ${failed.join(", ")}`);
process.exit(exitCode);
