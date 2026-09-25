import Database from "better-sqlite3";
import LibsqlDatabase from "libsql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

let _db: DB | null = null;

/**
 * Open (or return) the process-wide database connection with safe pragmas.
 *
 * Two drivers, one synchronous better-sqlite3-compatible API:
 *  - LIBSQL_URL set  → remote libSQL/Turso database (production on ephemeral hosts).
 *    Reads and writes go straight to the cloud DB; survives redeploys/restarts.
 *  - LIBSQL_URL unset → local SQLite file under DATA_DIR (development).
 *
 * Note on pragmas: `journal_mode = WAL` and `busy_timeout` are local-file
 * concepts; the remote driver rejects/ignores them, so they are only applied
 * to local files.
 */
export function getDb(): DB {
  if (_db) return _db;

  if (config.libsqlUrl) {
    // Remote (Turso / libSQL server). Same synchronous API as better-sqlite3
    // (the generic variance between the two type declarations is structural
    // noise — cast through the runtime-compatible constructor signature).
    const Ctor = LibsqlDatabase as unknown as new (
      filename: string,
      options: { authToken?: string },
    ) => DB;
    const remote = new Ctor(config.libsqlUrl, {
      authToken: config.libsqlAuthToken || undefined,
    });
    try {
      remote.pragma("foreign_keys = ON");
    } catch {
      /* server-side default applies */
    }
    _db = remote;
    runMigrations(remote);
    return remote;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(path.join(config.dataDir, "hearth.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  _db = db;
  runMigrations(_db);
  return _db;
}

function runMigrations(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const applied = new Set(
    (db.prepare(`SELECT name FROM _migrations`).all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  // src/db.ts -> src -> server root; migrations live at apps/server/migrations.
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const apply = db.transaction(() => {
      db.exec(fs.readFileSync(path.join(dir, file), "utf8"));
      db.prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`).run(file, Date.now());
    });
    apply();
  }
}

/* --------------------------- typed row helpers --------------------------- */

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  is_platform_admin: 0 | 1;
  is_suspended: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface ProfileRow {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  privacy_profile_visibility: "everyone" | "friends" | "private";
  privacy_friend_requests: "everyone" | "friends_of_friends" | "nobody";
  privacy_room_invites: "everyone" | "friends" | "nobody";
  privacy_show_online: 0 | 1;
  updated_at: number;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: "lobby" | "playing" | "closed";
  game_id: string | null;
  settings: string;
  created_at: number;
  updated_at: number;
}

export interface RoomMemberRow {
  room_id: string;
  user_id: string;
  role: "host" | "player";
  ready: 0 | 1;
  joined_at: number;
}

export interface SessionRow {
  id: string;
  room_id: string;
  game_id: string;
  status: "active" | "completed" | "aborted";
  state: string;
  created_at: number;
  ended_at: number | null;
}

export interface MessageRow {
  id: string;
  room_id: string;
  session_id: string | null;
  sender_id: string | null;
  kind: "text" | "system" | "media";
  body: string;
  media_id: string | null;
  deleted: 0 | 1;
  created_at: number;
}
