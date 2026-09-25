import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  zUsername,
  zPassword,
  zEmail,
  zDisplayName,
  zBio,
  defaultRoomSettings,
  type PrivacySettings,
  type RoomView,
  type SelfProfile,
} from "@hearth/shared";
import { getDb } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword, createSession, destroySession, userForToken } from "../auth.js";
import {
  createUserWithProfile,
  getUserByEmail,
  getUserByUsername,
  getProfileBits,
  updateProfileFields,
  updatePrivacyFields,
  privacyOf,
  audit,
} from "../store.js";
import { now, newId, sha256Hex, randomToken } from "../util.js";

const zPrivacy = z.object({
  profileVisibility: z.enum(["everyone", "friends", "private"]),
  friendRequests: z.enum(["everyone", "friends_of_friends", "nobody"]),
  roomInvites: z.enum(["everyone", "friends", "nobody"]),
  showOnlineStatus: z.boolean(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  const register = z.object({
    username: zUsername,
    email: zEmail,
    password: zPassword,
    displayName: zDisplayName,
  });

  // RATE_LIMIT_*_MAX overrides exist for the test runner (all suite clients
  // share one loopback IP); production defaults are the values below.
  const RL = {
    login: { config: { rateLimit: { max: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 8), timeWindow: "1 minute" } } },
    register: { config: { rateLimit: { max: Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 12), timeWindow: "1 minute" } } },
    reset: { config: { rateLimit: { max: Number(process.env.RATE_LIMIT_RESET_MAX ?? 3), timeWindow: "1 minute" } } },
  } as const;

  app.post("/register", RL.register, async (req, reply) => {
    const parsed = register.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const { username, email, password, displayName } = parsed.data;
    if (getUserByUsername(username)) {
      return reply.code(409).send({ error: "Username is already taken" });
    }
    if (getUserByEmail(email)) {
      return reply.code(409).send({ error: "An account with this email already exists" });
    }
    const passwordHash = await hashPassword(password);
    const isAdmin = config.adminUsernames.includes(username.toLowerCase()) && !db.prepare(`SELECT 1 FROM users LIMIT 1`).get();
    const user = createUserWithProfile({ username, email, passwordHash, displayName, isAdmin: !!isAdmin });
    const token = createSession(user.id, req.headers["user-agent"] ?? "");
    setAuthCookie(reply, token);
    audit(user.id, "auth.register", user.id);
    return selfProfileFor(user.id, reply);
  });

  app.post("/login", RL.login, async (req, reply) => {
    const parsed = z
      .object({ identifier: z.string().min(1).max(200), password: z.string().min(1).max(200) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { identifier, password } = parsed.data;
    const user = identifier.includes("@") ? getUserByEmail(identifier) : getUserByUsername(identifier);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !ok) {
      // Constant-shape error, no user enumeration.
      return reply.code(401).send({ error: "Wrong username or password" });
    }
    if (user.is_suspended) return reply.code(403).send({ error: "This account is suspended" });
    const token = createSession(user.id, req.headers["user-agent"] ?? "");
    setAuthCookie(reply, token);
    audit(user.id, "auth.login", user.id);
    return selfProfileFor(user.id, reply);
  });

  app.post("/logout", async (req, reply) => {
    const token = readCookieToken(req);
    if (token) destroySession(token);
    reply.clearCookie(config.cookieName, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    const user = req.currentUser;
    if (!user) return reply.code(401).send({ error: "Not signed in" });
    return selfProfileFor(user.id, reply);
  });

  const profileUpdate = z.object({
    displayName: zDisplayName.optional(),
    bio: zBio.optional(),
    privacy: zPrivacy.optional(),
    avatarMediaId: z.string().max(80).nullable().optional(),
  });

  app.patch("/profile", async (req, reply) => {
    const user = req.currentUser;
    if (!user) return reply.code(401).send({ error: "Not signed in" });
    const parsed = profileUpdate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const bits = getProfileBits(user.id);
    if (!bits) return reply.code(500).send({ error: "Profile missing" });
    if (parsed.data.displayName !== undefined || parsed.data.bio !== undefined) {
      updateProfileFields(user.id, { displayName: parsed.data.displayName, bio: parsed.data.bio });
    }
    if (parsed.data.avatarMediaId !== undefined) {
      // Avatar must be an image uploaded by this user.
      if (parsed.data.avatarMediaId === null) {
        db.prepare(`UPDATE profiles SET avatar_media_id = NULL, updated_at = ? WHERE user_id = ?`).run(now(), user.id);
      } else {
        const media = db
          .prepare(`SELECT uploaded_by, kind FROM media WHERE id = ?`)
          .get(parsed.data.avatarMediaId) as { uploaded_by: string; kind: string } | undefined;
        if (!media || media.uploaded_by !== user.id || media.kind !== "avatar") {
          return reply.code(403).send({ error: "That image can't be used as an avatar" });
        }
        db.prepare(`UPDATE profiles SET avatar_media_id = ?, updated_at = ? WHERE user_id = ?`).run(
          parsed.data.avatarMediaId,
          now(),
          user.id,
        );
      }
    }
    if (parsed.data.privacy) updatePrivacyFields(user.id, parsed.data.privacy as PrivacySettings);
    return selfProfileFor(user.id, reply);
  });

  app.post("/password", async (req, reply) => {
    const user = req.currentUser;
    if (!user) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z
      .object({ currentPassword: z.string().min(1).max(200), newPassword: zPassword })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(parsed.data.currentPassword, row.password_hash))) {
      return reply.code(403).send({ error: "Current password is incorrect" });
    }
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(await hashPassword(parsed.data.newPassword), now(), user.id);
    // Invalidate all other sessions.
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(
      user.id,
      sha256Hex(readCookieToken(req) ?? ""),
    );
    audit(user.id, "auth.password_change", user.id);
    return { ok: true };
  });

  app.post("/password-reset", RL.reset, async (req, reply) => {
    const parsed = z.object({ identifier: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const user = parsed.data.identifier.includes("@")
      ? getUserByEmail(parsed.data.identifier)
      : getUserByUsername(parsed.data.identifier);
    // Always answer the same shape (no enumeration). Reset without SMTP is
    // documented: the token is logged server-side (see docs/SECURITY.md).
    if (user) {
      const token = randomToken(32);
      db.prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      ).run(newId("prt"), user.id, sha256Hex(token), now() + 1000 * 60 * 30);
      const link = `${config.publicOrigin}/reset-password?token=${token}`;
      if (config.smtp.host) {
        // NOTE: SMTP delivery is implemented as a log write in this build.
        app.log.info({ link }, "password_reset_email");
      } else {
        app.log.warn({ link }, "password_reset_no_smtp_token_logged");
      }
      audit(null, "auth.password_reset_requested", user.id);
    }
    return { ok: true, message: "If that account exists, a reset link has been created." };
  });

  app.post("/password-reset/confirm", async (req, reply) => {
    const parsed = z
      .object({ token: z.string().min(10).max(200), newPassword: zPassword })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const row = db
      .prepare(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`)
      .get(sha256Hex(parsed.data.token)) as
      | { id: string; user_id: string; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < now()) {
      return reply.code(400).send({ error: "This reset link is invalid or has expired" });
    }
    db.transaction(() => {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
        .run(hashPassword(parsed.data.newPassword), now(), row.user_id);
      db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(now(), row.id);
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(row.user_id);
    })();
    audit(row.user_id, "auth.password_reset_completed", row.user_id);
    return { ok: true };
  });
}

export function readCookieToken(req: { cookies?: Record<string, string | undefined> }): string | undefined {
  return req.cookies?.[config.cookieName];
}

export function setAuthCookie(
  reply: { setCookie: (name: string, value: string, opts: Record<string, unknown>) => unknown },
  token: string,
): void {
  reply.setCookie(config.cookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
  });
}

function selfProfileFor(userId: string, reply?: unknown): SelfProfile {
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as
    | import("../db.js").UserRow
    | undefined;
  if (!user) throw new Error("user missing");
  const bits = getProfileBits(userId)!;
  return {
    id: user.id,
    username: user.username,
    displayName: bits.display_name,
    bio: bits.bio || null,
    avatarUrl: bits.avatar_media_id ? `/api/media/file/${bits.avatar_media_id}` : null,
    email: user.email,
    createdAt: new Date(user.created_at).toISOString(),
    isPlatformAdmin: user.is_platform_admin === 1,
    privacy: privacyOf(bits),
  };
}
