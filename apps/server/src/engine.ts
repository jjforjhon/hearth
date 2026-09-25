import type { Server } from "socket.io";
import { z } from "zod";
import { defaultRoomSettings, MAX_PLAYERS, type GameModule, type GameEffect, type BaseGameState } from "@hearth/shared";
import {
  activeSessionForRoom,
  bumpScore,
  createGameSession,
  endSession,
  getProfileBits,
  getRoom,
  getRoomMember,
  getSession,
  getUserById,
  insertMessage,
  leaveRoom,
  listRoomMembers,
  listSessionScores,
  recordGameEvent,
  roomView,
  setReady as setMemberReady,
  setRoomGame,
  setRoomStatus,
  transferHost,
  updateRoomSettings,
  updateSessionState,
} from "./store.js";
import { getDb } from "./db.js";
import { getGame } from "./games/registry.js";
import { now } from "./util.js";

const settingsPatchSchema = z.object({
  truthOrDare: z
    .object({ maxTier: z.union([z.literal(1), z.literal(2), z.literal(3)]), allowMedia: z.boolean() })
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
    .object({ rounds: z.number().int().min(3).max(25), secondsPerRound: z.number().int().min(10).max(120) })
    .partial()
    .optional(),
});

/**
 * Server-authoritative game engine. The client can only emit `game:action`;
 * everything else (state, turns, scores, reveals) is computed here and pushed out.
 */

interface RoomRuntime {
  online: Set<string>;
  lastSeen: Map<string, number>; // userId -> last disconnect time
  tickTimer: NodeJS.Timeout | null;
}

export class Engine {
  private io: Server;
  private runtimes = new Map<string, RoomRuntime>();

  constructor(io: Server) {
    this.io = io;
    // Sweep: end sessions whose rooms have been empty for 2 minutes.
    const sweep = setInterval(() => this.sweep(), 30_000);
    sweep.unref?.();
  }

  /* ------------------------------- presence ------------------------------- */

  async addPresence(roomId: string, userId: string): Promise<void> {
    const rt = this.runtime(roomId);
    const wasOnline = rt.online.has(userId);
    rt.online.add(userId);
    rt.lastSeen.delete(userId);
    const socketRooms = [`room:${roomId}`, `user:${userId}`];
    for (const r of socketRooms) await this.joinSocketRooms(roomId, userId, r);
    if (!wasOnline) {
      this.broadcastRoomView(roomId);
      this.pushSystemMessage(roomId, null, `${this.displayName(roomId, userId)} joined the room`);
    }
    // If a game is active, (re)send this user their private view.
    const session = activeSessionForRoom(roomId);
    if (session) {
      const mod = getGame(session.game_id as never) as GameModule<BaseGameState> | undefined;
      if (mod) this.emitPersonalView(session, mod);
    }
  }

  removePresence(roomId: string, userId: string): void {
    const rt = this.runtime(roomId);
    rt.online.delete(userId);
    rt.lastSeen.set(userId, now());
    this.broadcastRoomView(roomId);
    this.pushSystemMessage(roomId, null, `${this.displayName(roomId, userId)} left the room`);
    const room = getRoom(roomId);
    if (room && room.status === "playing") {
      const members = listRoomMembers(roomId);
      const anyOnline = members.some((m) => rt.online.has(m.user_id));
      if (!anyOnline) {
        // Everyone gone: pause is implicit; sweep() will abort the session if they stay away.
      }
    }
  }

  private async joinSocketRooms(roomId: string, userId: string, name: string): Promise<void> {
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) {
      if ((s.data as { roomId?: string }).roomId === roomId) s.join(name);
    }
  }

  onlineIn(roomId: string): Set<string> {
    return this.runtime(roomId).online;
  }

  allOnlineUserIds(): Set<string> {
    const out = new Set<string>();
    for (const rt of this.runtimes.values()) {
      for (const id of rt.online) out.add(id);
    }
    return out;
  }

  isOnline(roomId: string, userId: string): boolean {
    return this.runtime(roomId).online.has(userId);
  }

  private runtime(roomId: string): RoomRuntime {
    let rt = this.runtimes.get(roomId);
    if (!rt) {
      rt = { online: new Set(), lastSeen: new Map(), tickTimer: null };
      this.runtimes.set(roomId, rt);
    }
    return rt;
  }

  private sweep(): void {
    const t = now();
    for (const [roomId, rt] of this.runtimes) {
      if (rt.online.size > 0) continue;
      const members = listRoomMembers(roomId);
      const allGone = members.length === 0 || members.every((m) => (rt.lastSeen.get(m.user_id) ?? 0) < t - 120_000);
      if (!allGone) continue;
      const session = activeSessionForRoom(roomId);
      if (session) this.abortSession(session.id);
      const room = getRoom(roomId);
      if (room && room.status !== "closed" && members.length === 0) setRoomStatus(roomId, "closed");
      if (members.length === 0) {
        this.runtimes.delete(roomId);
      }
    }
  }

  /* ------------------------------ broadcasting ----------------------------- */

  broadcastRoomView(roomId: string): void {
    const room = getRoom(roomId);
    if (!room) return;
    this.io.in(`room:${roomId}`).emit("room:view", roomView(room, this.runtime(roomId).online));
  }

  emitPersonalView(session: import("./db.js").SessionRow, mod: GameModule<BaseGameState>): void {
    const room = getRoom(session.room_id);
    if (!room) return;
    const members = listRoomMembers(session.room_id);
    const extras = {
      members: members.map((m) => {
        const p = getProfileBits(m.user_id);
        const u = getUserById(m.user_id);
        return {
          userId: m.user_id,
          displayName: p?.display_name ?? u?.username ?? "Unknown",
          username: u?.username ?? "unknown",
          avatarUrl: p?.avatar_media_id ? `/api/media/file/${p.avatar_media_id}` : null,
        };
      }),
      hostId: room.host_id,
    };
    const state = JSON.parse(session.state) as BaseGameState;
    const rt = this.runtime(session.room_id);
    for (const m of members) {
      if (!rt.online.has(m.user_id)) continue;
      const view = mod.view(state, m.user_id, extras);
      this.io.in(`user:${m.user_id}`).emit("game:state", { sessionId: session.id, view });
    }
  }

  pushSystemMessage(roomId: string, sessionId: string | null, body: string): void {
    const msg = insertMessage({ roomId, sessionId, senderId: null, kind: "system", body });
    this.io.in(`room:${roomId}`).emit("chat:message", { ...msg, reactions: {} });
  }

  broadcastChatMessage(roomId: string, msg: unknown): void {
    this.io.in(`room:${roomId}`).emit("chat:message", msg);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.io.in(`user:${userId}`).emit(event, payload);
  }

  emitToRoom(roomId: string, event: string, payload: unknown): void {
    this.io.in(`room:${roomId}`).emit(event, payload);
  }

  private displayName(roomId: string, userId: string): string {
    const p = getProfileBits(userId);
    return p?.display_name ?? "Someone";
  }

  /* ------------------------------ room actions ----------------------------- */

  onMemberLeft(roomId: string, userId: string): void {
    const res = leaveRoom(roomId, userId);
    if (!res.ok) return;
    this.pushSystemMessage(roomId, null, `${this.displayName(roomId, userId)} left the room`);
    this.afterMembershipChange(roomId, userId);
  }

  onMemberKicked(roomId: string, userId: string): void {
    const res = leaveRoom(roomId, userId);
    if (!res.ok) return;
    this.emitToUser(userId, "room:kicked", { roomId });
    this.pushSystemMessage(roomId, null, `${this.displayName(roomId, userId)} was removed by the host`);
    this.afterMembershipChange(roomId, userId);
  }

  transferHost(roomId: string, targetId: string): void {
    const res = transferHost(roomId, targetId, getRoom(roomId)?.host_id ?? "");
    if (!res.ok) return;
    this.pushSystemMessage(roomId, null, `${this.displayName(roomId, targetId)} is now the host`);
    this.broadcastRoomView(roomId);
  }

  setReady(roomId: string, userId: string, ready: boolean): void {
    setMemberReady(roomId, userId, ready);
    this.broadcastRoomView(roomId);
  }

  selectGame(roomId: string, gameId: string | null): void {
    setRoomGame(roomId, gameId);
    if (gameId) {
      const mod = getGame(gameId as never);
      this.pushSystemMessage(roomId, null, mod ? `${mod.name} selected` : "Game selected");
    }
    this.broadcastRoomView(roomId);
  }

  updateSettings(roomId: string, raw: unknown): { ok: boolean; error?: string } {
    const parsed = settingsPatchSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid settings" };
    const room = getRoom(roomId);
    if (!room) return { ok: false, error: "Room not found" };
    const current = JSON.parse(room.settings || "{}") as Record<string, unknown>;
    const merged = { ...defaultRoomSettings, ...current } as Record<string, Record<string, unknown>>;
    for (const key of ["truthOrDare", "drawTogether", "truthFalse"] as const) {
      const patch = parsed.data[key];
      if (patch) merged[key] = { ...merged[key], ...patch };
    }
    updateRoomSettings(roomId, merged);
    this.broadcastRoomView(roomId);
    return { ok: true };
  }

  onSocketDisconnect(roomId: string, userId: string): void {
    // Only mark offline when this user's last socket for the room is gone.
    void this.io.in(`user:${userId}`).fetchSockets().then((sockets) => {
      const stillHere = sockets.some((s) => (s.data as { roomId?: string }).roomId === roomId);
      if (!stillHere) this.removePresence(roomId, userId);
    });
  }

  private afterMembershipChange(roomId: string, userId: string): void {
    this.stopTicking(roomId);
    const session = activeSessionForRoom(roomId);
    if (session) {
      const mod = getGame(session.game_id as never) as GameModule<BaseGameState> | undefined;
      const members = listRoomMembers(roomId);
      if (mod) {
        try {
          const state = JSON.parse(session.state) as BaseGameState;
          const effect = mod.onPlayerLeft?.(state, userId, { playerIds: members.map((m) => m.user_id) }) ?? null;
          if (effect) {
            updateSessionState(session.id, effect.state);
            for (const body of effect.systemMessages ?? []) {
              this.pushSystemMessage(roomId, session.id, body);
            }
            if (effect.completed) {
              this.finalizeCompleted(session.id, mod, effect.state);
              this.broadcastRoomView(roomId);
              return;
            }
          }
        } catch {
          /* state repair below */
        }
        if (members.length < mod.minPlayers) {
          this.abortSession(session.id);
        } else {
          const fresh = getSession(session.id);
          if (fresh) {
            this.emitPersonalView(fresh, mod);
            this.startTicking(fresh, mod);
          }
        }
      }
    }
    this.broadcastRoomView(roomId);
  }

  /* -------------------------------- lifecycle ------------------------------ */

  startGame(roomId: string, actorId: string): { ok: boolean; error?: string } {
    const room = getRoom(roomId);
    if (!room) return { ok: false, error: "Room not found" };
    if (room.host_id !== actorId) return { ok: false, error: "Only the host can start the game" };
    if (room.status === "playing") return { ok: false, error: "A game is already running" };
    if (activeSessionForRoom(roomId)) return { ok: false, error: "A game is already running" };
    if (!room.game_id) return { ok: false, error: "Select a game first" };
    const mod = getGame(room.game_id as never) as GameModule<BaseGameState> | undefined;
    if (!mod) return { ok: false, error: "Unknown game" };
    const members = listRoomMembers(roomId);
    if (members.length < mod.minPlayers) {
      return { ok: false, error: `${mod.name} needs at least ${mod.minPlayers} players` };
    }
    if (members.length > Math.min(MAX_PLAYERS, mod.maxPlayers)) {
      return { ok: false, error: `Too many players for ${mod.name}` };
    }
    const settings = JSON.parse(room.settings) as Parameters<GameModule<BaseGameState>["createState"]>[0]["settings"];
    const state = mod.createState({ playerIds: members.map((m) => m.user_id), settings });
    const session = createGameSession(roomId, room.game_id, state);
    setRoomStatus(roomId, "playing");
    recordGameEvent(session.id, actorId, "game_started", { game: room.game_id });
    this.pushSystemMessage(roomId, session.id, `${mod.name} started — have fun!`);
    this.broadcastRoomView(roomId);
    const fresh = getSession(session.id) as typeof session;
    this.emitPersonalView(fresh, mod);
    this.startTicking(fresh, mod);
    return { ok: true };
  }

  abortSession(sessionId: string): void {
    const session = getSession(sessionId);
    if (!session || session.status !== "active") return;
    this.stopTicking(session.room_id);
    endSession(sessionId, "aborted");
    this.pushSystemMessage(session.room_id, sessionId, "The game was ended.");
    this.broadcastRoomView(session.room_id);
  }

  private startTicking(session: { id: string; room_id: string }, mod: GameModule<BaseGameState>): void {
    if (!mod.tick) return;
    const rt = this.runtime(session.room_id);
    this.stopTicking(session.room_id);
    rt.tickTimer = setInterval(() => {
      const s = getSession(session.id);
      if (!s || s.status !== "active") {
        this.stopTicking(session.room_id);
        return;
      }
      // Skip ticks while every player is offline so timeouts don't burn in the
      // background; state resumes when someone returns.
      const rtNow = this.runtime(s.room_id);
      if (rtNow.online.size === 0) return;
      this.applyModuleResult(s, mod, () =>
        mod.tick!(
          JSON.parse(s.state) as BaseGameState,
          {
            playerIds: listRoomMembers(s.room_id).map((m) => m.user_id),
            settings: JSON.parse(getRoom(s.room_id)?.settings ?? "{}") as never,
            now: now(),
          },
        ),
      );
    }, 1000);
    rt.tickTimer.unref?.();
  }

  private stopTicking(roomId: string): void {
    const rt = this.runtimes.get(roomId);
    if (rt?.tickTimer) {
      clearInterval(rt.tickTimer);
      rt.tickTimer = null;
    }
  }

  /* --------------------------------- actions ------------------------------- */

  handleAction(roomId: string, userId: string, action: string, payload: unknown): { ok: boolean; error?: string } {
    const member = getRoomMember(roomId, userId);
    if (!member) return { ok: false, error: "You are not in this room" };
    // Host-privileged game actions are enforced HERE, server-side — never in the client.
    if (action === "pass_turn") {
      const room = getRoom(roomId);
      if (!room || room.host_id !== userId) return { ok: false, error: "Only the host can pass a turn" };
    }
    const session = activeSessionForRoom(roomId);
    if (!session) return { ok: false, error: "No active game" };
    const mod = getGame(session.game_id as never) as GameModule<BaseGameState> | undefined;
    if (!mod) return { ok: false, error: "Unknown game" };

    // The game module owns payload validation via its actionSchema.
    const check = z.object({}).passthrough().safeParse(payload);
    if (!check.success) return { ok: false, error: "Malformed payload" };
    recordGameEvent(session.id, userId, `action:${action}`, { ok: true });

    const state = JSON.parse(session.state) as BaseGameState;
    let result: ReturnType<GameModule<BaseGameState>["onAction"]>;
    try {
      result = mod.onAction(state, {
        userId,
        payload: { action, ...((payload as object) ?? {}) },
        playerIds: listRoomMembers(roomId).map((m) => m.user_id),
        settings: JSON.parse(getRoom(roomId)?.settings ?? "{}") as never,
        now: now(),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid action" };
    }
    return this.applyModuleResult(session, mod, () => result);
  }

  private applyModuleResult(
    session: { id: string; room_id: string; game_id: string; status: string },
    mod: GameModule<BaseGameState>,
    compute: () => GameEffect<BaseGameState> | null,
  ): { ok: boolean; error?: string } {
    let result: GameEffect<BaseGameState> | null;
    try {
      result = compute();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid action" };
    }
    if (!result) return { ok: true };
    const persisted: ReturnType<typeof insertMessage>[] = [];
    const tx = getDb().transaction(() => {
      updateSessionState(session.id, result.state);
      for (const body of result.systemMessages ?? []) {
        persisted.push(
          insertMessage({ roomId: session.room_id, sessionId: session.id, senderId: null, kind: "system", body }),
        );
      }
    });
    tx();

    // Forward module-emitted realtime events (e.g. draw strokes) to the room.
    for (const ev of result.broadcastEvents ?? []) {
      this.emitToRoom(session.room_id, ev.event, ev.payload);
    }
    for (const msg of persisted) {
      this.broadcastChatMessage(session.room_id, { ...msg, reactions: {} });
    }
    if (result.completed) {
      this.finalizeCompleted(session.id, mod, result.state);
      this.stopTicking(session.room_id);
      this.broadcastRoomView(session.room_id);
    } else {
      const fresh = getSession(session.id);
      if (fresh) this.emitPersonalView(fresh, mod);
    }
    return { ok: true };
  }

  private finalizeCompleted(sessionId: string, mod: GameModule<BaseGameState>, state: BaseGameState): void {
    const session = getSession(sessionId);
    if (!session) return;
    if (session.status !== "active") return; // idempotency guard
    const summary = mod.scoreSummary(state);
    const tx = getDb().transaction(() => {
      for (const s of summary) bumpScore(sessionId, s.userId, s.score);
      recordGameEvent(sessionId, null, "game_completed", { scores: summary });
      endSession(sessionId, "completed");
    });
    tx();
    const final = listSessionScores(sessionId);
    const standings = final
      .map((s) => ({ ...s, displayName: this.displayName(session.room_id, s.userId) }))
      .sort((a, b) => b.score - a.score);
    this.emitToRoom(session.room_id, "game:completed", { sessionId, standings });
    this.pushSystemMessage(session.room_id, sessionId, "Game over — see the scoreboard!");
  }
}
