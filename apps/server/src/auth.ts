import crypto from "node:crypto";
import { getDb } from "./db.js";
import { config } from "./config.js";
import { now, randomToken, sha256Hex, newId } from "./util.js";
import type { UserRow } from "./db.js";

/* ------------------------------ passwords ------------------------------- */

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `s1$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "s1") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "hex");
  const expected = Buffer.from(parts[5]!, "hex");
  const actual = await scrypt(password, salt, expected.length, { N, r, p });
  return crypto.timingSafeEqual(actual, expected);
}

async function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: opts.N, r: opts.r, p: opts.p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/* ------------------------------- sessions ------------------------------- */

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export function createSession(userId: string, userAgent: string): string {
  const db = getDb();
  const token = randomToken(32);
  const t = now();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("ses"), userId, sha256Hex(token), t, t + config.sessionTtlMs, t, userAgent.slice(0, 200));
  return token;
}

export function destroySession(token: string): void {
  getDb()
    .prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .run(sha256Hex(token));
}

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const t = now();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.id, u.username, u.is_platform_admin, u.is_suspended, p.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN profiles p ON p.user_id = u.id
       WHERE s.token_hash = ?`,
    )
    .get(sha256Hex(token)) as
    | (UserRow & { sid: string; expires_at: number; last_seen_at: number; display_name: string })
    | undefined;
  if (!row) return null;
  if (row.is_suspended) return null;
  if (row.expires_at < t) return null;
  if (row.last_seen_at < t - config.sessionIdleMs) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256Hex(token));
    return null;
  }
  if (t - row.last_seen_at > 60_000) {
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).run(t, sha256Hex(token));
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isPlatformAdmin: row.is_platform_admin === 1,
  };
}
