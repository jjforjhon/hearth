-- Hearth initial schema. SQLite. Applied by the tiny migration runner in src/db.ts.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,           -- scrypt: N:r:p:salt:hash, hex
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  is_suspended  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio          TEXT NOT NULL DEFAULT '',
  avatar_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  privacy_profile_visibility TEXT NOT NULL DEFAULT 'everyone'
    CHECK (privacy_profile_visibility IN ('everyone','friends','private')),
  privacy_friend_requests TEXT NOT NULL DEFAULT 'everyone'
    CHECK (privacy_friend_requests IN ('everyone','friends_of_friends','nobody')),
  privacy_room_invites TEXT NOT NULL DEFAULT 'everyone'
    CHECK (privacy_room_invites IN ('everyone','friends','nobody')),
  privacy_show_online INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,        -- sha256 of the opaque cookie token
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE friendships (
  user_a   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);
CREATE INDEX idx_friendships_b ON friendships(user_b);

CREATE TABLE friend_requests (
  id         TEXT PRIMARY KEY,
  from_user  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (from_user, to_user)
);

CREATE TABLE blocks (
  blocker   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker, blocked)
);

CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  host_id    TEXT NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','closed')),
  game_id    TEXT,
  settings   TEXT NOT NULL DEFAULT '{}',  -- JSON RoomSettings
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_rooms_host ON rooms(host_id);

CREATE TABLE room_members (
  room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('host','player')),
  ready     INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE game_sessions (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','aborted')),
  state      TEXT NOT NULL DEFAULT '{}',  -- authoritative JSON, written only by GameModule
  created_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX idx_sessions_room ON game_sessions(room_id);

CREATE TABLE game_players (
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL DEFAULT 0,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE game_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id    TEXT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_game_events_session ON game_events(session_id);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES game_sessions(id) ON DELETE CASCADE, -- NULL = room chat
  sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,        -- NULL = system
  kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system','media')),
  body       TEXT NOT NULL,
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_room ON messages(room_id, created_at);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);

CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  uploaded_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id      TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('avatar','photo','video','voice','drawing')),
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'room' CHECK (visibility IN ('room','private')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE weekly_batches (
  id            TEXT PRIMARY KEY,
  week_key      TEXT NOT NULL UNIQUE,      -- e.g. 2026-W39
  provider      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'generating'
                CHECK (status IN ('generating','validating','ready','published','failed','rolled_back')),
  requested_count INTEGER NOT NULL,
  accepted_count  INTEGER NOT NULL DEFAULT 0,
  rejected_count  INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  safety_rejected INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  published_at INTEGER
);

CREATE TABLE content_items (
  id           TEXT PRIMARY KEY,
  batch_id     TEXT REFERENCES weekly_batches(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('truth','dare','statement','prompt','word','choice_pair')),
  category     TEXT NOT NULL,
  difficulty   INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  language     TEXT NOT NULL DEFAULT 'en',
  body         TEXT,
  options      TEXT,                        -- JSON array for choice_pair
  media_policy TEXT NOT NULL DEFAULT 'none' CHECK (media_policy IN ('none','optional','required')),
  media_kinds  TEXT NOT NULL DEFAULT '[]',  -- JSON array
  content_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending')),
  published    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  UNIQUE (content_hash)
);
CREATE INDEX idx_content_lookup ON content_items(kind, status, published, difficulty);

CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL CHECK (target_type IN ('user','message','media','content')),
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at   INTEGER NOT NULL,
  resolved_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  INTEGER
);
CREATE INDEX idx_reports_status ON reports(status, created_at);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE achievements (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log(created_at);
