import type { Server } from "socket.io";
import { z } from "zod";
import { userForToken } from "./auth.js";
import { config } from "./config.js";
import { getRoom, getRoomMember, getRoomByCode, joinRoom, getSession, activeSessionForRoom, roomView, audit } from "./store.js";
import type { Engine } from "./engine.js";

/**
 * Realtime gateway. Security model:
 * - handshake authenticates the session cookie; unauthenticated sockets rejected
 * - `room:join` verifies membership (or a valid join by code) SERVER-SIDE
 * - every subsequent event re-verifies membership before touching state
 * - clients cannot emit privileged events (state, scores, reveals are server-computed)
 */

const roomJoinSchema = z.object({ code: z.string().min(4).max(12) });
const actionSchema = z.object({ action: z.string().min(1).max(40), payload: z.unknown().optional() });
const typingSchema = z.object({ sessionId: z.string().max(64).optional() });

export function wireRealtime(io: Server, engine: Engine): void {
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    const token = cookieHeader
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${config.cookieName}=`))
      ?.slice(config.cookieName.length + 1);
    const user = userForToken(token ? decodeURIComponent(token) : undefined);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as { id: string; displayName: string; isPlatformAdmin: boolean };
    socket.join(`user:${user.id}`);

    socket.on("room:join", async (raw, ack?: (res: unknown) => void) => {
      const parsed = roomJoinSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: "Invalid join request" });
      const room = getRoomByCode(parsed.data.code.toUpperCase());
      if (!room || room.status === "closed") return ack?.({ ok: false, error: "This invite is not valid" });
      let member = getRoomMember(room.id, user.id);
      if (!member) {
        const res = joinRoom(room.id, user.id);
        if (!res.ok) return ack?.({ ok: false, error: res.error ?? "Cannot join" });
        member = getRoomMember(room.id, user.id)!;
        audit(user.id, "room.joined", room.id);
      }
      socket.data.roomId = room.id;
      await socket.join(`room:${room.id}`);
      engine.addPresence(room.id, user.id);
      const fresh = getRoom(room.id);
      if (fresh) socket.emit("room:view", roomView(fresh, engine.onlineIn(room.id)));
      // Replay active game session pointer and recent chat for reconnects.
      const session = activeSessionForRoom(room.id);
      if (session) socket.emit("game:session", { sessionId: session.id, gameId: session.game_id });
      ack?.({ ok: true, roomId: room.id });
    });

    socket.on("room:leave", async () => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      if (getRoomMember(roomId, user.id)) {
        engine.onMemberLeft(roomId, user.id);
      }
      socket.data.roomId = undefined;
      await socket.leave(`room:${roomId}`);
      socket.emit("room:left", { roomId });
    });

    socket.on("room:kick", async (raw, ack?: (res: unknown) => void) => {
      const parsed = z.object({ userId: z.string().min(1).max(64) }).safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId) return ack?.({ ok: false, error: "Invalid request" });
      const room = getRoom(roomId);
      if (!room || room.host_id !== user.id) return ack?.({ ok: false, error: "Only the host can kick players" });
      if (!getRoomMember(roomId, parsed.data.userId)) return ack?.({ ok: false, error: "Not a member" });
      engine.onMemberKicked(roomId, parsed.data.userId);
      audit(user.id, "room.kicked", parsed.data.userId, { room: roomId });
      ack?.({ ok: true });
    });

    socket.on("room:transfer_host", async (raw, ack?: (res: unknown) => void) => {
      const parsed = z.object({ userId: z.string().min(1).max(64) }).safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId) return ack?.({ ok: false, error: "Invalid request" });
      const room = getRoom(roomId);
      if (!room || room.host_id !== user.id) return ack?.({ ok: false, error: "Only the host can transfer host" });
      if (!getRoomMember(roomId, parsed.data.userId)) return ack?.({ ok: false, error: "Not a member" });
      engine.transferHost(roomId, parsed.data.userId);
      audit(user.id, "room.host_transferred", parsed.data.userId, { room: roomId });
      ack?.({ ok: true });
    });

    socket.on("room:ready", (raw, ack?: (res: unknown) => void) => {
      const parsed = z.object({ ready: z.boolean() }).safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId || !getRoomMember(roomId, user.id)) return ack?.({ ok: false });
      engine.setReady(roomId, user.id, parsed.data.ready);
      ack?.({ ok: true });
    });

    socket.on("room:select_game", (raw, ack?: (res: unknown) => void) => {
      const parsed = z.object({ gameId: z.string().min(1).max(40).nullable() }).safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId) return ack?.({ ok: false, error: "Invalid request" });
      const room = getRoom(roomId);
      if (!room || room.host_id !== user.id) return ack?.({ ok: false, error: "Only the host can select the game" });
      if (room.status === "playing") return ack?.({ ok: false, error: "A game is running" });
      engine.selectGame(roomId, parsed.data.gameId);
      ack?.({ ok: true });
    });

    socket.on("room:start", (_raw, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return ack?.({ ok: false, error: "Not in a room" });
      const res = engine.startGame(roomId, user.id);
      ack?.(res);
    });

    socket.on("room:settings", (raw, ack?: (res: unknown) => void) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return ack?.({ ok: false, error: "Not in a room" });
      const room = getRoom(roomId);
      if (!room || room.host_id !== user.id) return ack?.({ ok: false, error: "Only the host can change settings" });
      const res = engine.updateSettings(roomId, raw);
      ack?.(res);
    });

    socket.on("game:action", (raw, ack?: (res: unknown) => void) => {
      const parsed = actionSchema.safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId) return ack?.({ ok: false, error: "Invalid action" });
      const res = engine.handleAction(roomId, user.id, parsed.data.action, parsed.data.payload ?? {});
      ack?.(res);
    });

    socket.on("chat:typing", (raw) => {
      const parsed = typingSchema.safeParse(raw);
      const roomId = socket.data.roomId as string | undefined;
      if (!parsed.success || !roomId) return;
      socket.to(`room:${roomId}`).emit("chat:typing", { userId: user.id, name: user.displayName });
    });

    socket.on("disconnect", () => {
      const roomId = socket.data.roomId as string | undefined;
      if (roomId) engine.onSocketDisconnect(roomId, user.id);
    });
  });
}


