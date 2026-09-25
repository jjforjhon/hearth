import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GAME_IDS, defaultRoomSettings, type RoomView } from "@hearth/shared";
import {
  getRoom,
  getRoomByCode,
  getRoomMember,
  createRoom,
  updateRoomSettings,
  setRoomGame,
  setReady,
  joinRoom,
  leaveRoom,
  kickMember,
  transferHost,
  audit,
  getMessage,
  insertMessage,
  deleteMessage,
  listMessages,
  listReactionsFor,
  toggleReaction,
  roomView,
  getProfileBits,
  getUserById,
} from "../store.js";
import { getDb } from "../db.js";
import type { RoomSettings } from "@hearth/shared";

declare module "fastify" {
  interface FastifyInstance {
    hearth: {
      onlineUserIds(): Set<string>;
      broadcastRoomView(roomId: string): void;
      onMemberLeft(roomId: string, userId: string): void;
      onMemberKicked(roomId: string, userId: string): void;
      emitToRoom(roomId: string, event: string, payload: unknown): void;
      broadcastChatMessage(roomId: string, msg: unknown): void;
      startGame(roomId: string, actorId: string): { ok: boolean; error?: string };
    };
  }
}

function displayNameOf(userId: string): string {
  const p = getProfileBits(userId);
  return p?.display_name ?? getUserById(userId)?.username ?? "Unknown";
}

function onlineSetFor(app: { hearth: { onlineUserIds(): Set<string> } }): Set<string> {
  return app.hearth.onlineUserIds();
}

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z
      .object({ name: z.string().trim().min(1).max(60) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Room name must be 1-60 characters" });
    // Limit active hosted rooms per user to keep the DB tidy.
    const hosted = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM rooms WHERE host_id = ? AND status != 'closed'`)
      .get(me.id) as { c: number };
    if (hosted.c >= 5) return reply.code(429).send({ error: "You already have 5 active rooms" });
    const room = createRoom(me.id, parsed.data.name);
    audit(me.id, "room.created", room.id);
    return { room: roomView(room, onlineSetFor(app)) };
  });

  app.get("/:id", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const room = getRoom(id);
    if (!room) return reply.code(404).send({ error: "Room not found" });
    // Authorization: only members may view room details.
    const member = getRoomMember(id, me.id);
    if (!member) return reply.code(403).send({ error: "You are not in this room" });
    return { room: roomView(room, onlineSetFor(app)) };
  });

  app.post("/join/:code", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(req.params);
    const room = getRoomByCode(code.toUpperCase());
    if (!room || room.status === "closed") return reply.code(404).send({ error: "This invite is not valid" });
    const res = joinRoom(room.id, me.id);
    if (!res.ok) return reply.code(409).send({ error: res.error ?? "Cannot join room" });
    audit(me.id, "room.joined", room.id);
    req.server.hearth.broadcastRoomView(room.id);
    return { room: roomView(room, onlineSetFor(app)) };
  });

  const settingsSchema = z.object({
    truthOrDare: z
      .object({
        maxTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        allowMedia: z.boolean(),
      })
      .partial()
      .optional(),
    drawTogether: z
      .object({
        mode: z.enum(["creative", "template"]),
        templateId: z.string().max(40).nullable().optional(),
        roundSeconds: z.number().int().min(60).max(3600),
      })
      .partial()
      .optional(),
    truthFalse: z
      .object({
        rounds: z.number().int().min(3).max(25),
        secondsPerRound: z.number().int().min(10).max(120),
      })
      .partial()
      .optional(),
  });

  app.patch("/:id/settings", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const room = getRoom(id);
    if (!room) return reply.code(404).send({ error: "Room not found" });
    if (room.host_id !== me.id) return reply.code(403).send({ error: "Only the host can change settings" });
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid settings" });
    const current = JSON.parse(room.settings || "{}") as Partial<RoomSettings>;
    const merged: RoomSettings = {
      ...defaultRoomSettings,
      ...current,
      truthOrDare: { ...defaultRoomSettings.truthOrDare, ...current.truthOrDare, ...parsed.data.truthOrDare },
      drawTogether: { ...defaultRoomSettings.drawTogether, ...current.drawTogether, ...parsed.data.drawTogether },
      truthFalse: { ...defaultRoomSettings.truthFalse, ...current.truthFalse, ...parsed.data.truthFalse },
    };
    updateRoomSettings(id, merged);
    req.server.hearth.broadcastRoomView(id);
    return { room: roomView(getRoom(id)!, onlineSetFor(app)) };
  });

  app.post("/:id/game", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const room = getRoom(id);
    if (!room) return reply.code(404).send({ error: "Room not found" });
    if (room.host_id !== me.id) return reply.code(403).send({ error: "Only the host can select the game" });
    const parsed = z.object({ gameId: z.enum(GAME_IDS).nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Unknown game" });
    if (room.status === "playing") return reply.code(409).send({ error: "A game is running" });
    setRoomGame(id, parsed.data.gameId);
    req.server.hearth.broadcastRoomView(id);
    return { room: roomView(getRoom(id)!, onlineSetFor(app)) };
  });

  app.post("/:id/ready", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!getRoomMember(id, me.id)) return reply.code(403).send({ error: "You are not in this room" });
    const parsed = z.object({ ready: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    setReady(id, me.id, parsed.data.ready);
    req.server.hearth.broadcastRoomView(id);
    return { room: roomView(getRoom(id)!, onlineSetFor(app)) };
  });

  app.post("/:id/start", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!getRoomMember(id, me.id)) return reply.code(403).send({ error: "You are not in this room" });
    const res = req.server.hearth.startGame(id, me.id);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    return { ok: true };
  });

  app.post("/:id/leave", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!getRoomMember(id, me.id)) return reply.code(404).send({ error: "You are not in this room" });
    const res = leaveRoom(id, me.id);
    if (res.ok) {
      req.server.hearth.onMemberLeft(id, me.id);
      audit(me.id, "room.left", id);
    }
    return { ok: res.ok };
  });

  app.post("/:id/kick", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const body = (req.body ?? {}) as { userId?: string };
    const parsed = z
      .object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) })
      .safeParse({ id: (req.params as { id?: string }).id, userId: body.userId });
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const res = kickMember(parsed.data.id, parsed.data.userId, me.id);
    if (!res.ok) return reply.code(res.error === "Only the host can kick players" ? 403 : 400).send({ error: res.error });
    req.server.hearth.onMemberKicked(parsed.data.id, parsed.data.userId);
    audit(me.id, "room.kicked", parsed.data.userId, { room: parsed.data.id });
    return { ok: true };
  });

  app.post("/:id/transfer-host", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const body = (req.body ?? {}) as { userId?: string };
    const parsed = z
      .object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) })
      .safeParse({ id: (req.params as { id?: string }).id, userId: body.userId });
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const res = transferHost(parsed.data.id, parsed.data.userId, me.id);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    req.server.hearth.broadcastRoomView(parsed.data.id);
    audit(me.id, "room.host_transferred", parsed.data.userId, { room: parsed.data.id });
    return { ok: true };
  });

  /* ------------------------------- chat REST ------------------------------- */

  app.get("/:id/messages", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!getRoomMember(id, me.id)) return reply.code(403).send({ error: "You are not in this room" });
    const q = z
      .object({ sessionId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    const rows = listMessages(id, q.sessionId ?? null, q.limit ?? 80);
    const reactions = listReactionsFor(rows.map((r) => r.id));
    return {
      messages: rows.map((r) => ({
        id: r.id,
        roomSessionId: r.session_id ?? "room",
        senderId: r.sender_id,
        senderName: r.sender_id ? displayNameOf(r.sender_id) : null,
        kind: r.kind,
        body: r.deleted ? "[removed]" : r.body,
        mediaUrl: r.media_id ? `/api/media/file/${r.media_id}` : null,
        createdAt: new Date(r.created_at).toISOString(),
        reactions: reactions.get(r.id) ?? {},
      })),
    };
  });

  app.post(
    "/:id/messages",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!getRoomMember(id, me.id)) return reply.code(403).send({ error: "You are not in this room" });
    const parsed = z
      .object({
        body: z.string().trim().min(1).max(1000),
        sessionId: z.string().max(64).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Message must be 1-1000 characters" });
    const msg = insertMessage({
      roomId: id,
      sessionId: parsed.data.sessionId ?? null,
      senderId: me.id,
      kind: "text",
      body: parsed.data.body,
    });
    req.server.hearth.broadcastChatMessage(id, {
      id: msg.id,
      roomSessionId: msg.session_id ?? "room",
      senderId: msg.sender_id,
      senderName: me.displayName,
      kind: msg.kind,
      body: msg.body,
      mediaUrl: null,
      createdAt: new Date(msg.created_at).toISOString(),
      reactions: {},
    });
    return { ok: true, id: msg.id };
  });

  app.delete("/:messageId", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { messageId } = z.object({ messageId: z.string().min(1).max(64) }).parse(req.params);
    const msg = getMessage(messageId);
    if (!msg) return reply.code(404).send({ error: "Message not found" });
    // Authorization: sender or host may delete; membership verified first.
    if (!getRoomMember(msg.room_id, me.id)) return reply.code(403).send({ error: "Not allowed" });
    if (msg.sender_id !== me.id && getRoom(msg.room_id)?.host_id !== me.id) {
      return reply.code(403).send({ error: "Not allowed" });
    }
    deleteMessage(messageId);
    req.server.hearth.emitToRoom(msg.room_id, "chat:deleted", { id: messageId });
    return { ok: true };
  });

  app.post("/:messageId/react", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { messageId } = z.object({ messageId: z.string().min(1).max(64) }).parse(req.params);
    const parsed = z.object({ emoji: z.string().min(1).max(8) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid reaction" });
    const msg = getMessage(messageId);
    if (!msg) return reply.code(404).send({ error: "Message not found" });
    if (!getRoomMember(msg.room_id, me.id)) return reply.code(403).send({ error: "Not allowed" });
    const result = toggleReaction(messageId, me.id, parsed.data.emoji);
    req.server.hearth.emitToRoom(msg.room_id, "chat:reaction", {
      id: messageId,
      emoji: parsed.data.emoji,
      userId: me.id,
      op: result,
    });
    return { ok: true };
  });
}

/** Message-scoped routes mounted at /api/messages (membership checked per message). */
export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.delete("/:messageId", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { messageId } = z.object({ messageId: z.string().min(1).max(64) }).parse(req.params);
    const msg = getMessage(messageId);
    if (!msg) return reply.code(404).send({ error: "Message not found" });
    // Authorization: sender or host may delete; membership verified first.
    if (!getRoomMember(msg.room_id, me.id)) return reply.code(403).send({ error: "Not allowed" });
    if (msg.sender_id !== me.id && getRoom(msg.room_id)?.host_id !== me.id) {
      return reply.code(403).send({ error: "Not allowed" });
    }
    deleteMessage(messageId);
    req.server.hearth.emitToRoom(msg.room_id, "chat:deleted", { id: messageId });
    return { ok: true };
  });

  app.post("/:messageId/react", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { messageId } = z.object({ messageId: z.string().min(1).max(64) }).parse(req.params);
    const parsed = z.object({ emoji: z.string().min(1).max(8) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid reaction" });
    const msg = getMessage(messageId);
    if (!msg) return reply.code(404).send({ error: "Message not found" });
    if (!getRoomMember(msg.room_id, me.id)) return reply.code(403).send({ error: "Not allowed" });
    const result = toggleReaction(messageId, me.id, parsed.data.emoji);
    req.server.hearth.emitToRoom(msg.room_id, "chat:reaction", {
      id: messageId,
      emoji: parsed.data.emoji,
      userId: me.id,
      op: result,
    });
    return { ok: true };
  });
}


