import {
  defaultRoomSettings,
  MAX_PLAYERS,
  type FriendRequestView,
  type FriendView,
  type RoomView,
} from "@hearth/shared";
import { getDb } from "./db.js";
import { now, newId } from "./util.js";
import crypto from "node:crypto";
import type { MessageRow, RoomMemberRow, RoomRow, SessionRow } from "./db.js";

/* ------------------------------- profiles ------------------------------- */

export interface ProfileBits {
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

export function getUserByUsername(username: string) {
  return getDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username) as
    | import("./db.js").UserRow
    | undefined;
}

export function getUserByEmail(email: string) {
  return getDb().prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
    | import("./db.js").UserRow
    | undefined;
}

export function getUserById(id: string) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    | import("./db.js").UserRow
    | undefined;
}

export function getProfileBits(userId: string): ProfileBits | undefined {
  return getDb().prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(userId) as
    ProfileBits | undefined;
}

export function createUserWithProfile(input: {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  isAdmin: boolean;
}): import("./db.js").UserRow {
  const db = getDb();
  const t = now();
  const id = newId("usr");
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, is_platform_admin, is_suspended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, input.username, input.email, input.passwordHash, input.isAdmin ? 1 : 0, t, t);
    db.prepare(
      `INSERT INTO profiles (user_id, display_name, bio, avatar_media_id, privacy_profile_visibility,
        privacy_friend_requests, privacy_room_invites, privacy_show_online, updated_at)
       VALUES (?, ?, '', NULL, 'everyone', 'everyone', 'everyone', 1, ?)`,
    ).run(id, input.displayName, t);
  });
  tx();
  return getUserById(id)!;
}

export function updateProfileFields(
  userId: string,
  fields: { displayName?: string; bio?: string },
): void {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (fields.displayName !== undefined) {
    sets.push("display_name = ?");
    args.push(fields.displayName);
  }
  if (fields.bio !== undefined) {
    sets.push("bio = ?");
    args.push(fields.bio);
  }
  if (!sets.length) return;
  args.push(now(), userId);
  db.prepare(`UPDATE profiles SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`).run(...args);
}

export function updatePrivacyFields(userId: string, privacy: import("@hearth/shared").PrivacySettings): void {
  getDb()
    .prepare(
      `UPDATE profiles SET privacy_profile_visibility = ?, privacy_friend_requests = ?,
       privacy_room_invites = ?, privacy_show_online = ?, updated_at = ? WHERE user_id = ?`,
    )
    .run(privacy.profileVisibility, privacy.friendRequests, privacy.roomInvites,
      privacy.showOnlineStatus ? 1 : 0, now(), userId);
}

export function privacyOf(p: ProfileBits): import("@hearth/shared").PrivacySettings {
  return {
    profileVisibility: p.privacy_profile_visibility,
    friendRequests: p.privacy_friend_requests,
    roomInvites: p.privacy_room_invites,
    showOnlineStatus: p.privacy_show_online === 1,
  };
}

/* ------------------------------- friends -------------------------------- */

export function areFriends(a: string, b: string): boolean {
  return !!getDb().prepare(
    `SELECT 1 FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`,
  ).get(a, b, b, a);
}

export function isBlocked(blocker: string, blocked: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?`).get(blocker, blocked);
}

export function hasEitherBlocked(a: string, b: string): boolean {
  return isBlocked(a, b) || isBlocked(b, a);
}

export function friendIdsOf(userId: string): string[] {
  return (
    getDb().prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other
       FROM friendships WHERE user_a = ? OR user_b = ?`,
    ).all(userId, userId, userId) as Array<{ other: string }>
  ).map((r) => r.other);
}

export function friendView(userId: string, onlineSet: Set<string>): FriendView {
  const p = getProfileBits(userId);
  const u = getUserById(userId);
  const showOnline = p ? p.privacy_show_online === 1 : true;
  return {
    userId,
    displayName: p?.display_name ?? u?.username ?? "Unknown",
    username: u?.username ?? "unknown",
    avatarUrl: p?.avatar_media_id ? `/api/media/file/${p.avatar_media_id}` : null,
    online: showOnline && onlineSet.has(userId),
  };
}

export function listFriends(userId: string, onlineSet: Set<string>): FriendView[] {
  return friendIdsOf(userId).map((fid) => friendView(fid, onlineSet));
}

export function createFriendRequest(fromUser: string, toUser: string): string {
  const db = getDb();
  const existing = db.prepare(
    `SELECT * FROM friend_requests WHERE from_user = ? AND to_user = ?`,
  ).get(fromUser, toUser) as { id: string } | undefined;
  if (existing) return existing.id;
  const reverse = db.prepare(
    `SELECT * FROM friend_requests WHERE from_user = ? AND to_user = ?`,
  ).get(toUser, fromUser) as { id: string } | undefined;
  if (reverse) {
    // Mutual request -> auto-accept into friendship.
    acceptFriendRequest(reverse.id, fromUser);
    return reverse.id;
  }
  const id = newId("frq");
  db.prepare(
    `INSERT INTO friend_requests (id, from_user, to_user, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, fromUser, toUser, now());
  return id;
}

export function acceptFriendRequest(requestId: string, asUser: string): boolean {
  const db = getDb();
  const req = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(requestId) as
    | { id: string; from_user: string; to_user: string }
    | undefined;
  if (!req || req.to_user !== asUser) return false;
  const tx = db.transaction(() => {
    const [a, b] = [req.from_user, req.to_user].sort();
    db.prepare(
      `INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)`,
    ).run(a, b, now());
    db.prepare(`DELETE FROM friend_requests WHERE id = ? OR (from_user = ? AND to_user = ?)`)
      .run(requestId, req.to_user, req.from_user);
  });
  tx();
  return true;
}

export function declineFriendRequest(requestId: string, asUser: string): boolean {
  const req = getDb().prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(requestId) as
    | { to_user: string }
    | undefined;
  if (!req || req.to_user !== asUser) return false;
  getDb().prepare(`DELETE FROM friend_requests WHERE id = ?`).run(requestId);
  return true;
}

export function cancelFriendRequest(requestId: string, asUser: string): boolean {
  const req = getDb().prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(requestId) as
    | { from_user: string }
    | undefined;
  if (!req || req.from_user !== asUser) return false;
  getDb().prepare(`DELETE FROM friend_requests WHERE id = ?`).run(requestId);
  return true;
}

export function removeFriendship(a: string, b: string): boolean {
  const [x, y] = [a, b].sort();
  const res = getDb().prepare(
    `DELETE FROM friendships WHERE user_a = ? AND user_b = ?`,
  ).run(x, y);
  return res.changes > 0;
}

export function listFriendRequests(userId: string): FriendRequestView[] {
  const rows = getDb().prepare(
    `SELECT fr.id, fr.from_user, fr.to_user, fr.created_at,
            p.display_name, u.username, p.avatar_media_id
     FROM friend_requests fr
     JOIN users u ON u.id = fr.from_user OR u.id = fr.to_user
     JOIN profiles p ON p.user_id = u.id
     WHERE fr.from_user = ? OR fr.to_user = ?
     ORDER BY fr.created_at DESC`,
  ).all(userId, userId) as Array<{
    id: string; from_user: string; to_user: string; created_at: number;
    display_name: string; username: string; avatar_media_id: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    direction: r.from_user === userId ? "outgoing" : "incoming",
    userId: r.from_user === userId ? r.to_user : r.from_user,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_media_id ? `/api/media/file/${r.avatar_media_id}` : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export function blockUser(blocker: string, blocked: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)`)
      .run(blocker, blocked, now());
    const [x, y] = [blocker, blocked].sort();
    db.prepare(`DELETE FROM friendships WHERE user_a = ? AND user_b = ?`).run(x, y);
    db.prepare(`DELETE FROM friend_requests WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)`)
      .run(blocker, blocked, blocked, blocker);
  });
  tx();
}

export function unblockUser(blocker: string, blocked: string): void {
  getDb().prepare(`DELETE FROM blocks WHERE blocker = ? AND blocked = ?`).run(blocker, blocked);
}

export function blockedIdsOf(userId: string): Set<string> {
  return new Set(
    (getDb().prepare(`SELECT blocked FROM blocks WHERE blocker = ?`).all(userId) as Array<{ blocked: string }>).map((r) => r.blocked),
  );
}

/* -------------------------------- rooms --------------------------------- */

export function getRoom(id: string): RoomRow | undefined {
  return getDb().prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as RoomRow | undefined;
}

export function getRoomByCode(code: string): RoomRow | undefined {
  return getDb().prepare(`SELECT * FROM rooms WHERE code = ?`).get(code) as RoomRow | undefined;
}

export function getRoomMember(roomId: string, userId: string): RoomMemberRow | undefined {
  return getDb().prepare(
    `SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`,
  ).get(roomId, userId) as RoomMemberRow | undefined;
}

export function listRoomMembers(roomId: string): RoomMemberRow[] {
  return getDb().prepare(
    `SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC`,
  ).all(roomId) as RoomMemberRow[];
}

function roomCode(): string {
  // Unambiguous alphabet, 6 chars => 24^6 ≈ 191M codes.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i]! % alphabet.length];
    if (!getRoomByCode(code)) return code;
    // collision: loop retries with a new code
  }
}

export function createRoom(hostId: string, name: string): RoomRow {
  const db = getDb();
  const t = now();
  const id = newId("room");
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO rooms (id, code, name, host_id, status, game_id, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'lobby', NULL, ?, ?, ?)`,
    ).run(id, roomCode(), name.slice(0, 60), hostId, JSON.stringify(defaultRoomSettings), t, t);
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role, ready, joined_at) VALUES (?, ?, 'host', 1, ?)`,
    ).run(id, hostId, t);
  });
  tx();
  return getRoom(id)!;
}

export function updateRoomSettings(roomId: string, settings: unknown): void {
  getDb().prepare(`UPDATE rooms SET settings = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(settings), now(), roomId);
  }

export function setRoomGame(roomId: string, gameId: string | null): void {
  getDb().prepare(`UPDATE rooms SET game_id = ?, updated_at = ? WHERE id = ?`)
    .run(gameId, now(), roomId);
}

export function setRoomStatus(roomId: string, status: RoomRow["status"]): void {
  getDb().prepare(`UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), roomId);
}

export function setRoomHost(roomId: string, hostId: string): void {
  getDb().prepare(`UPDATE rooms SET host_id = ?, updated_at = ? WHERE id = ?`).run(hostId, now(), roomId);
}

export function joinRoom(roomId: string, userId: string): { ok: boolean; error?: string } {
  const db = getDb();
  const result: { ok: boolean; error?: string } = { ok: false };
  // The capacity check + insert run inside ONE transaction; better-sqlite3 is
  // synchronous, so concurrent joins serialize and the 11th insert is rejected
  // after the first 10 are committed.
  const tx = db.transaction(() => {
    const room = getRoom(roomId);
    if (!room || room.status === "closed") {
      result.error = "Room not found";
      return;
    }
    const members = listRoomMembers(roomId);
    if (members.some((m) => m.user_id === userId)) {
      result.ok = true; // idempotent rejoin
      return;
    }
    if (members.length >= MAX_PLAYERS) {
      result.error = "Room is full (10 players max)";
      return;
    }
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`,
    ).run(roomId, userId, now());
    result.ok = true;
  });
  tx();
  return result;
}

export function leaveRoom(roomId: string, userId: string): { ok: boolean; newHostId?: string } {
  const db = getDb();
  const member = getRoomMember(roomId, userId);
  if (!member) return { ok: false };
  const members = listRoomMembers(roomId);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).run(roomId, userId);
    let newHostId: string | undefined;
    if (member.role === "host") {
      const remaining = members.filter((m) => m.user_id !== userId);
      if (remaining.length > 0) {
        newHostId = remaining[0]!.user_id;
        db.prepare(`UPDATE room_members SET role = 'host' WHERE room_id = ? AND user_id = ?`).run(roomId, newHostId);
        db.prepare(`UPDATE rooms SET host_id = ?, updated_at = ? WHERE id = ?`).run(newHostId, now(), roomId);
      } else {
        setRoomStatus(roomId, "closed");
      }
   }
    // Remove readiness state of leaver
    db.prepare(`UPDATE room_members SET ready = 0 WHERE room_id = ? AND user_id = ?`).run(roomId, userId);
  });
  tx();
  const members2 = listRoomMembers(roomId);
  return { ok: true, newHostId: members2.length ? (getRoom(roomId)?.host_id ?? undefined) : undefined };
}

export function setReady(roomId: string, userId: string, ready: boolean): void {
  getDb().prepare(`UPDATE room_members SET ready = ? WHERE room_id = ? AND user_id = ?`)
    .run(ready ? 1 : 0, roomId, userId);
}

export function kickMember(roomId: string, targetId: string, actorId: string): { ok: boolean; error?: string } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: "Room not found" };
  if (room.host_id !== actorId) return { ok: false, error: "Only the host can kick players" };
  if (targetId === actorId) return { ok: false, error: "Host cannot kick themselves" };
  const member = getRoomMember(roomId, targetId);
  if (!member) return { ok: false, error: "Not a member" };
  leaveRoom(roomId, targetId);
  return { ok: true };
}

export function transferHost(roomId: string, targetId: string, actorId: string): { ok: boolean; error?: string } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: "Room not found" };
  if (room.host_id !== actorId) return { ok: false, error: "Only the host can transfer host" };
  if (!getRoomMember(roomId, targetId)) return { ok: false, error: "Target is not a member" };
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE room_members SET role = 'player' WHERE room_id = ? AND role = 'host'`).run(roomId);
    db.prepare(`UPDATE room_members SET role = 'host' WHERE room_id = ? AND user_id = ?`).run(roomId, targetId);
    db.prepare(`UPDATE rooms SET host_id = ?, updated_at = ? WHERE id = ?`).run(targetId, now(), roomId);
  });
  tx();
  return { ok: true };
}

import { config } from "./config.js";

export function roomView(room: RoomRow, onlineSet: Set<string>): RoomView {
  const members = listRoomMembers(room.id);
  const memberViews = members.map((m) => {
    const p = getProfileBits(m.user_id);
    const u = getUserById(m.user_id);
    const showOnline = p ? p.privacy_show_online === 1 : true;
    return {
      userId: m.user_id,
      displayName: p?.display_name ?? u?.username ?? "Unknown",
      username: u?.username ?? "unknown",
      avatarUrl: p?.avatar_media_id ? `/api/media/file/${p.avatar_media_id}` : null,
      role: m.role,
      ready: m.ready === 1,
      online: showOnline && onlineSet.has(m.user_id),
    };
  });
  return {
    id: room.id, code: room.code, name: room.name, status: room.status, hostId: room.host_id,
    gameId: (room.game_id as RoomView["gameId"]) ?? null,
    members: memberViews,
    settings: JSON.parse(room.settings || "{}") as RoomView["settings"],
    inviteUrl: `${config.publicOrigin}/join/${room.code}`,
    createdAt: new Date(room.created_at).toISOString(),
  }; 
}

/* ----------------------------- game sessions ---------------------------- */

export function createGameSession(roomId: string, gameId: string, state: unknown): SessionRow {
  const db = getDb();
  const t = now();
  const id = newId("gses");
  db.prepare(
    `INSERT INTO game_sessions (id, room_id, game_id, status, state, created_at) VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(id, roomId, gameId, JSON.stringify(state), t);
  const players = listRoomMembers(roomId);
  const tx = db.transaction(() => {
    for (const m of players) {
      db.prepare(
        `INSERT OR IGNORE INTO game_players (session_id, user_id, score, joined_at) VALUES (?, ?, 0, ?)`,
      ).run(id, m.user_id, t);
    }
  });
  tx();
  return getSession(id)!;
}

export function getSession(id: string): SessionRow | undefined {
  return getDb().prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id) as SessionRow | undefined;
}

export function activeSessionForRoom(roomId: string): SessionRow | undefined {
  return getDb().prepare(
    `SELECT * FROM game_sessions WHERE room_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
  ).get(roomId) as SessionRow | undefined;
  }

export function updateSessionState(sessionId: string, state: unknown): void {
  getDb().prepare(`UPDATE game_sessions SET state = ? WHERE id = ?`).run(JSON.stringify(state), sessionId);
}

export function endSession(sessionId: string, status: "completed" | "aborted"): void {
  const session = getSession(sessionId);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_sessions SET status = ?, ended_at = ? WHERE id = ?`).run(status, now(), sessionId);
    if (session) {
      db.prepare(`UPDATE rooms SET status = 'lobby', game_id = NULL, updated_at = ? WHERE id = ?`)
        .run(now(), session.room_id);
    }
  });
  tx();
}

export function bumpScore(sessionId: string, userId: string, delta: number): void
{  getDb().prepare(
    `UPDATE game_players SET score = score + ? WHERE session_id = ? AND user_id = ?`,
  ).run(delta, sessionId, userId);
}

export function listSessionScores(sessionId: string): Array<{ userId: string; score: number }> {
  return getDb().prepare(
    `SELECT user_id, score FROM game_players WHERE session_id = ?`,
  ).all(sessionId) as Array<{ userId: string; score: number }>;
  }

export function recordGameEvent(sessionId: string, userId: string | null, type: string, payload: unknown = {}): void {
  getDb().prepare(
    `INSERT INTO game_events (session_id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, type, JSON.stringify(payload), now());
}

/* -------------------------------- chat ---------------------------------- */

export function insertMessage(input: {
  roomId: string;
  sessionId: string | null;
  senderId: string | null;
  kind: "text" | "system" | "media";
  body: string;
  mediaId?: string | null;
}): MessageRow {
  const db = getDb();
  const id = newId("msg");
  db.prepare(
    `INSERT INTO messages (id, room_id, session_id, sender_id, kind, body, media_id, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, input.roomId, input.sessionId, input.senderId, input.kind, input.body, input.mediaId ?? null, now());
  return getMessage(id)!;
}

export function getMessage(id: string): MessageRow | undefined {
  return getDb().prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined;
}

export function listMessages(roomId: string, sessionId: string | null, limit = 80): MessageRow[] {
  const rows = getDb().prepare(
    `SELECT * FROM messages WHERE room_id = ? AND session_id IS ? AND deleted = 0
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(roomId, sessionId, limit) as MessageRow[];
  return rows.reverse();
}

export function deleteMessage(messageId: string): void {
  getDb().prepare(`UPDATE messages SET deleted = 1, body = '' WHERE id = ?`).run(messageId);
}

export function listReactionsFor(messageIds: string[]): Map<string, Record<string, string[]>> {
  const map = new Map<string, Record<string, string[]>>();
  if (!messageIds.length) return map;
  const db = getDb();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`,
  ).all(...messageIds) as Array<{ message_id: string; user_id: string; emoji: string }>;
  for (const r of rows) {
    let rec = map.get(r.message_id);
    if (!rec) {
      rec = {};
      map.set(r.message_id, rec);
    }
    (rec[r.emoji] ??= []).push(r.user_id);
  }
  return map;
}

export function toggleReaction(messageId: string, userId: string, emoji: string): "added" | "removed" {
  const db = getDb();
  const existing = db.prepare(
    `SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
  ).get(messageId, userId, emoji);
  if (existing) {
    db.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`)
      .run(messageId, userId, emoji);
    return "removed";
  }
  db.prepare(
    `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)`,
  ).run(messageId, userId, emoji, now());
  return "added";
}

/* -------------------------- notifications etc --------------------------- */

export function addNotification(userId: string, kind: string, payload: Record<string, unknown>): void {
  getDb().prepare(
    `INSERT INTO notifications (id, user_id, kind, payload, read, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(newId("ntf"), userId, kind, JSON.stringify(payload), now());
}

export function listNotifications(userId: string, limit = 50): Array<{
  id: string; kind: string; payload: Record<string, unknown>; read: boolean; createdAt: string;
}> {
  return (
    getDb().prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(userId, limit) as Array<{ id: string; kind: string; payload: string; read: 0 | 1; created_at: number }>
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    read: r.read === 1,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export function markNotificationsRead(userId: string, ids: string[]): void {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  getDb().prepare(
    `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
  ).run(userId, ...ids);
}

export function unreadNotificationCount(userId: string): number {
  const row = getDb().prepare(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0`,
  ).get(userId) as { c: number };
  return row.c;
}

export function audit(actorId: string | null, action: string, target = "", details: Record<string, unknown> = {}): void {
  getDb().prepare(
    `INSERT INTO audit_log (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(actorId, action, target, JSON.stringify(details), now());
}

export function createReport(input: {
  reporterId: string;
  targetType: "user" | "message" | "media" | "content";
  targetId: string;
  reason: string;
  details?: string;
}): string {
  const id = newId("rep");
  getDb().prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(id, input.reporterId, input.targetType, input.targetId, input.reason, input.details ?? "", now());
  return id;
}

/* ------------------------------- content -------------------------------- */

export function countContent(kind: "truth" | "dare", difficulty?: 1 | 2 | 3): number {
  const row = difficulty
    ? (getDb().prepare(
        `SELECT COUNT(*) AS c FROM content_items WHERE kind = ? AND status = 'active' AND published = 1 AND difficulty = ?`,
      ).get(kind, difficulty) as { c: number })
    : (getDb().prepare(
        `SELECT COUNT(*) AS c FROM content_items WHERE kind = ? AND status = 'active' AND published = 1`,
      ).get(kind) as { c: number });
  return row.c;
}

export function sampleContent(
  kind: "truth" | "dare",
  count: number,
  opts?: { maxDifficulty?: 1 | 2 | 3; excludeIds?: string[] },
): Array<{ id: string; kind: string; category: string; difficulty: number; body: string; media_policy: string; media_kinds: string }> {
  const db = getDb();
  const exclude = opts?.excludeIds ?? [];
  const rows = db.prepare(
    `SELECT id, kind, category, difficulty, body, media_policy, media_kinds FROM content_items
     WHERE kind = ? AND status = 'active' AND published = 1
       AND difficulty <= ?
     ORDER BY RANDOM() LIMIT ?`,
  ).all(kind, opts?.maxDifficulty ?? 3, count + exclude.length) as Array<{ id: string; kind: string; category: string; difficulty: number; body: string; media_policy: string; media_kinds: string }>;
  const filtered = rows.filter((r) => !exclude.includes(r.id)).slice(0, count);
  return filtered;
}

export function insertContentItem(item: {
  batchId: string | null;
  kind: "truth" | "dare" | "statement" | "prompt" | "word" | "choice_pair";
  category: string;
  difficulty: 1 | 2 | 3;
  language?: string;
  body: string | null;
  options?: string[] | null;
  mediaPolicy?: "none" | "optional" | "required";
  mediaKinds?: string[];
  contentHash: string;
  status?: "active" | "pending" | "disabled";
  published?: boolean;
}): { ok: boolean; duplicate?: boolean } {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO content_items (id, batch_id, kind, category, difficulty, language, body, options,
        media_policy, media_kinds, content_hash, status, published, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("cnt"), item.batchId, item.kind, item.category, item.difficulty, item.language ?? "en",
      item.body, item.options ? JSON.stringify(item.options) : null,
      item.mediaPolicy ?? "none", JSON.stringify(item.mediaKinds ?? []),
      item.contentHash, item.status ?? "active", item.published ? 1 : 0, now(),
    );
    return { ok: true };
  } catch {
    return { ok: false, duplicate: true }; // UNIQUE(content_hash) violation => duplicate
  }
}

export function listBatches(limit = 30): Array<{
  id: string; weekKey: string; provider: string; status: string;
  requested: number; accepted: number; rejected: number; duplicates: number; safetyRejected: number;
  error: string | null; createdAt: string; publishedAt: string | null;
}> {
  return (
    getDb().prepare(`SELECT * FROM weekly_batches ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<any>
  ).map((r) => ({
    id: r.id,
    weekKey: r.week_key,
    provider: r.provider,
    status: r.status,
    requested: r.requested_count,
    accepted: r.accepted_count,
    rejected: r.rejected_count,
    duplicates: r.duplicate_count,
    safetyRejected: r.safety_rejected,
    error: r.error ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
  }));
}

export function insertBatch(weekKey: string, provider: string, requested: number): string {
  const id = newId("batch");
  getDb().prepare(
    `INSERT INTO weekly_batches (id, week_key, provider, status, requested_count, accepted_count, rejected_count,
      duplicate_count, safety_rejected, error, created_at)
     VALUES (?, ?, ?, 'generating', ?, 0, 0, 0, 0, NULL, ?)`,
  ).run(id, weekKey, provider, requested, now());
  return id;
}

export function updateBatch(id: string, fields: Partial<{
  status: "generating" | "validating" | "ready" | "published" | "failed" | "rolled_back";
  acceptedCount: number; rejectedCount: number; duplicateCount: number; safetyRejected: number;
  error: string | null; publishedAt: number | null;
}>): void {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, string> = {
    status: "status",
    acceptedCount: "accepted_count",
    rejectedCount: "rejected_count",
    duplicateCount: "duplicate_count",
    safetyRejected: "safety_rejected",
    error: "error",
    publishedAt: "published_at",
  };
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${map[k]!} = ?`);
    args.push(v);
  }
  if (!sets.length) return;
  args.push(id);
  db.prepare(`UPDATE weekly_batches SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}

export function publishBatch(batchId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Accumulating publish (scoped to the weekly kinds — other games' pools are
    // evergreen): the new batch becomes available AND previously published
    // weekly items stay live until they age out of the newest-6 window. This
    // matches the product requirement that fresh items *become available*
    // weekly without shrinking the pool players actually draw from.
    db.prepare(`UPDATE content_items SET published = 1 WHERE batch_id = ?`).run(batchId);
    const keep = (
      db
        .prepare(
          `SELECT id FROM weekly_batches WHERE status IN ('published','ready') ORDER BY published_at DESC, created_at DESC LIMIT 6`,
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
    if (keep.length === 6) {
      const placeholders = keep.map(() => "?").join(",");
      db.prepare(
        `UPDATE content_items SET published = 0
         WHERE kind IN ('truth','dare') AND published = 1
           AND batch_id IS NOT NULL AND batch_id NOT IN (${placeholders})`,
      ).run(...keep);
    }
    db.prepare(`UPDATE weekly_batches SET status = 'published', published_at = ? WHERE id = ?`).run(now(), batchId);
  });
  tx();
}

export function rollbackToBatch(batchId: string): void {
  publishBatch(batchId);
}

export function disableContentItem(id: string): void {
  getDb().prepare(`UPDATE content_items SET status = 'disabled' WHERE id = ?`).run(id);
}

export function enableContentItem(id: string): void {
  getDb().prepare(`UPDATE content_items SET status = 'active' WHERE id = ?`).run(id);
}

export function searchContentItems(filter: {
  kind?: string; status?: string; search?: string; limit?: number;
}): Array<{ id: string; kind: string; category: string; difficulty: number; body: string | null; status: string; published: number; batchId: string | null }> {
  const db = getDb();
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filter.kind) {
    clauses.push(`kind = ?`);
    args.push(filter.kind);
  }
  if (filter.status) {
    clauses.push(`status = ?`);
    args.push(filter.status);
  }
  if (filter.search) {
    clauses.push(`body LIKE ?`);
    args.push(`%${filter.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT id, kind, category, difficulty, body, status, published, batch_id FROM content_items ${where}
     ORDER BY created_at DESC LIMIT ?`,
  ).all(...args, filter.limit ?? 100) as Array<{ id: string; kind: string; category: string; difficulty: number; body: string | null; status: string; published: number; batch_id: string | null }>;
  return rows.map((r) => ({ id: r.id, kind: r.kind, category: r.category, difficulty: r.difficulty, body: r.body, status: r.status, published: r.published, batchId: r.batch_id }));
}

export function contentPoolStats(): Array<{ kind: string; published: number; active: number }> {
  return getDb().prepare(
    `SELECT kind, SUM(published) AS published, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
     FROM content_items GROUP BY kind`,
  ).all() as Array<{ kind: string; published: number; active: number }>;
}

/** Generic sampler for non-truth/dare content (choice pairs, words, prompts, statements). */
export function sampleGenericContent(
  kind: string,
  category: string | null,
  count: number,
  excludeIds: string[] = [],
): Array<{ id: string; body: string | null; options: string[] | null; difficulty: number }> {
  const where = category ? `AND category = ?` : ``;
  const args: unknown[] = category ? [kind, category] : [kind];
  const rows = getDb()
    .prepare(
      `SELECT id, body, options, difficulty FROM content_items
       WHERE kind = ? ${where} AND status = 'active' AND published = 1
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(...args, count + excludeIds.length) as Array<{
    id: string;
    body: string | null;
    options: string | null;
    difficulty: number;
  }>;
  return rows
    .filter((r) => !excludeIds.includes(r.id))
    .slice(0, count)
    .map((r) => ({
      id: r.id,
      body: r.body,
      options: r.options ? (JSON.parse(r.options) as string[]) : null,
      difficulty: r.difficulty,
    }));
}

export { getDb } from "./db.js";

export function getMediaById(id: string):
  | { id: string; uploaded_by: string; kind: string; mime: string; room_id: string | null }
  | undefined {
  return getDb().prepare(`SELECT id, uploaded_by, kind, mime, room_id FROM media WHERE id = ?`).get(id) as
    | { id: string; uploaded_by: string; kind: string; mime: string; room_id: string | null }
    | undefined;
}
