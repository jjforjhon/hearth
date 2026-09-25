import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GAME_IDS, zDisplayName } from "@hearth/shared";
import {
  listFriends,
  blockUser,
  areFriends,
  cancelFriendRequest,
  createFriendRequest,
  createReport,
  friendIdsOf,
  getProfileBits,
  getRoom,
  getRoomMember,
  getUserById,
  getUserByUsername,
  hasEitherBlocked,
  listFriendRequests,
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriendship,
  unblockUser,
  blockedIdsOf,
  addNotification,
  audit,
} from "../store.js";

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  /** Search users by exact username (privacy-conscious: no fuzzy directory). */
  app.get("/users/:username", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { username } = z.object({ username: z.string().min(1).max(40) }).parse(req.params);
    const target = getUserByUsername(username);
    if (!target || target.id === me.id) return reply.code(404).send({ error: "User not found" });
    const bits = getProfileBits(target.id);
    if (!bits) return reply.code(404).send({ error: "User not found" });
    const friends = areFriends(me.id, target.id);
    if (bits.privacy_profile_visibility === "private" && !friends) {
      return { id: target.id, username: target.username, displayName: bits.display_name, bio: null, avatarUrl: null, isPrivate: true };
    }
    if (bits.privacy_profile_visibility === "friends" && !friends) {
      return { id: target.id, username: target.username, displayName: bits.display_name, bio: null, avatarUrl: null, isPrivate: true };
    }
    return {
      id: target.id,
      username: target.username,
      displayName: bits.display_name,
      bio: bits.bio || null,
      avatarUrl: bits.avatar_media_id ? `/api/media/file/${bits.avatar_media_id}` : null,
      isPrivate: false,
    };
  });

  app.get("/friends", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    return {
      friends: listFriends(me.id, req.server.hearth.onlineUserIds()),
      requests: listFriendRequests(me.id),
      blocked: [...blockedIdsOf(me.id)],
    };
  });

  app.post("/friends/requests", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z.object({ username: z.string().min(1).max(40) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const target = getUserByUsername(parsed.data.username);
    if (!target || target.id === me.id) return reply.code(404).send({ error: "User not found" });
    if (areFriends(me.id, target.id)) return reply.code(409).send({ error: "You are already friends" });
    if (hasEitherBlocked(me.id, target.id)) return reply.code(404).send({ error: "User not found" });
    const bits = getProfileBits(target.id);
    if (!bits) return reply.code(404).send({ error: "User not found" });
    if (bits.privacy_friend_requests === "nobody") {
      return reply.code(403).send({ error: "This user is not accepting friend requests" });
    }
    if (bits.privacy_friend_requests === "friends_of_friends") {
      const mutual = friendIdsOf(me.id).some((fid) => friendIdsOf(fid).includes(target.id));
      if (!mutual) return reply.code(403).send({ error: "This user only accepts requests from friends of friends" });
    }
    createFriendRequest(me.id, target.id);
    addNotification(target.id, "friend_request", { fromUserId: me.id, fromName: me.displayName });
    audit(me.id, "friend.request_sent", target.id);
    return { ok: true };
  });

  app.post("/friends/requests/:id/accept", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const ok = acceptFriendRequest(id, me.id);
    if (!ok) return reply.code(404).send({ error: "Request not found" });
    return { ok: true };
  });

  app.post("/friends/requests/:id/decline", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const ok = declineFriendRequest(id, me.id);
    if (!ok) return reply.code(404).send({ error: "Request not found" });
    return { ok: true };
  });

  app.delete("/friends/requests/:id", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const ok = cancelFriendRequest(id, me.id);
    if (!ok) return reply.code(404).send({ error: "Request not found" });
    return { ok: true };
  });

  app.delete("/friends/:userId", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(req.params);
    removeFriendship(me.id, userId);
    return { ok: true };
  });

  app.post("/blocks", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z.object({ userId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    if (parsed.data.userId === me.id) return reply.code(400).send({ error: "You cannot block yourself" });
    blockUser(me.id, parsed.data.userId);
    audit(me.id, "user.blocked", parsed.data.userId);
    return { ok: true };
  });

  app.delete("/blocks/:userId", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(req.params);
    unblockUser(me.id, userId);
    return { ok: true };
  });

  app.get("/notifications", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    return { notifications: listNotifications(me.id), unread: unreadNotificationCount(me.id) };
  });

  app.post("/notifications/read", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z.object({ ids: z.array(z.string().max(64)).max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    markNotificationsRead(me.id, parsed.data.ids);
    return { ok: true };
  });

  app.post("/reports", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z
      .object({
        targetType: z.enum(["user", "message", "media", "content"]),
        targetId: z.string().min(1).max(128),
        reason: z.enum(["harassment", "spam", "inappropriate_content", "dangerous", "other"]),
        details: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid report" });
    createReport({ reporterId: me.id, ...parsed.data });
    audit(me.id, "report.created", parsed.data.targetId, { type: parsed.data.targetType });
    return { ok: true };
  });
}
