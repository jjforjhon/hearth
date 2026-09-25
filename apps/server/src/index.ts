import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import path from "node:path";
import fs from "node:fs";
import cron from "node-cron";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { userForToken } from "./auth.js";
import { readCookieToken } from "./routes/auth.js";
import { Engine } from "./engine.js";
import { wireRealtime } from "./realtime.js";
import { authRoutes } from "./routes/auth.js";
import { socialRoutes } from "./routes/social.js";
import { roomRoutes, messageRoutes } from "./routes/rooms.js";
import { mediaRoutes } from "./routes/media.js";
import { adminRoutes } from "./routes/admin.js";
import { runWeeklyPipeline, ensureContentBootstrapped } from "./content/pipeline.js";
import { seedAllOtherGames } from "./content/seed-other.js";
import { listAllGameMetadata } from "./games/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: { level: config.isProduction ? "info" : "warn" },
  trustProxy: true,
  bodyLimit: 45 * 1024 * 1024, // media uploads stream through this route
});

/* ------------------------------ security headers ------------------------------ */

app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.isProduction) {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; script-src 'self'",
    );
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

await app.register(cookie);
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  // Stricter per-route limits are declared on sensitive routes.
});

// Binary upload parser: hands the raw buffer to media upload handlers.
app.addContentTypeParser(
  ["application/octet-stream", "multipart/form-data"],
  { parseAs: "buffer" },
  (_req, body, done) => done(null, body),
);

/* --------------------------- decorate app/server --------------------------- */

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: { id: string; username: string; displayName: string; isPlatformAdmin: boolean };
  }
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

app.decorateRequest("currentUser", undefined);

/* --------------------------------- auth hook -------------------------------- */

app.addHook("onRequest", async (req) => {
  if (!req.url.startsWith("/api/")) return;
  const token = readCookieToken(req);
  const user = userForToken(token);
  if (user) req.currentUser = user;
});

/* ------------------------------ error handling ------------------------------ */

// Zod validation failures become 400s with a human message, never raw 500s.
app.setErrorHandler((err: unknown, _req, reply) => {
  const e = err as FastifyError;
  if (typeof (e as { issues?: unknown }).issues !== "undefined" && Array.isArray((e as { issues?: unknown[] }).issues)) {
    // ZodError shape
    const issues = (e as unknown as { issues: Array<{ message?: string }> }).issues;
    return reply.code(400).send({ error: issues[0]?.message ?? "Invalid input" });
  }
  const statusCode = typeof e.statusCode === "number" ? e.statusCode : 500;
  if (statusCode >= 500) {
    app.log.error({ err }, "internal error");
    return reply.code(500).send({ error: "Something went wrong on our side. Please try again." });
  }
  return reply.code(statusCode).send({ error: e.message ?? "Request failed" });
});

/* ---------------------------------- routes ---------------------------------- */

await app.register(
  async (api) => {
    // Each route group gets its own encapsulated prefix scope.
    await api.register(async (auth) => authRoutes(auth), { prefix: "/auth" });
    await socialRoutes(api);
    await api.register(async (rooms) => roomRoutes(rooms), { prefix: "/rooms" });
    // Message-scoped routes live at /api/messages/* (membership verified per message).
    await api.register(async (msgs) => messageRoutes(msgs), { prefix: "/messages" });
    api.post("/join/:code", (req, reply) =>
      reply.redirect(`/api/rooms/join/${(req.params as { code: string }).code}`, 307),
    );
    await api.register(async (media) => mediaRoutes(media), { prefix: "/media" });
    await api.register(async (admin) => adminRoutes(admin), { prefix: "/admin" });

    api.get("/games", async () => {
      return { games: listAllGameMetadata() };
    });

    api.get("/health", async () => ({ ok: true, time: Date.now() }));
  },
  { prefix: "/api" },
);

/* --------------------------------- realtime --------------------------------- */

const io = new Server(app.server, {
  cors: { origin: config.publicOrigin, credentials: true },
  maxHttpBufferSize: 6e6, // drawing strokes batched by the client stay small
});

const engine = new Engine(io);
wireRealtime(io, engine);

// Decorate after engine creation so route handlers can drive realtime behavior.
app.decorate("hearth", {
  onlineUserIds: () => engine.allOnlineUserIds(),
  broadcastRoomView: (roomId: string) => engine.broadcastRoomView(roomId),
  onMemberLeft: (roomId: string, userId: string) => engine.onMemberLeft(roomId, userId),
  onMemberKicked: (roomId: string, userId: string) => engine.onMemberKicked(roomId, userId),
  emitToRoom: (roomId: string, event: string, payload: unknown) => engine.emitToRoom(roomId, event, payload),
  broadcastChatMessage: (roomId: string, msg: unknown) => engine.broadcastChatMessage(roomId, msg),
  startGame: (roomId: string, actorId: string) => engine.startGame(roomId, actorId),
});

/* ----------------------------- scheduled content ---------------------------- */

ensureContentBootstrapped();
seedAllOtherGames();

try {
  if (config.disableInProcessCron) {
    app.log.info(
      "in-process content cron disabled (HEARTH_DISABLE_CRON=1) — schedule via GitHub Actions POST /api/admin/cron/weekly",
    );
  } else if (cron.validate(config.contentCron)) {
    cron.schedule(config.contentCron, () => {
      void runWeeklyPipeline().catch((err) => app.log.error({ err }, "weekly pipeline crashed"));
    });
    app.log.info(`content cron scheduled: ${config.contentCron}`);
  } else {
    app.log.warn(`invalid CONTENT_CRON "${config.contentCron}" — weekly pipeline disabled`);
  }
} catch (err) {
  app.log.warn({ err }, "cron setup failed");
}

/* ------------------------------- static client ------------------------------ */

const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/socket.io")) {
      return reply.code(404).send({ error: "Not found" });
    }
    // SPA fallback
    return reply.sendFile("index.html");
  });
} else {
  app.log.warn("web dist not found — run `npm run build:web` to serve the client");
}

/* ---------------------------------- start ----------------------------------- */

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Hearth listening on :${config.port} (origin ${config.publicOrigin})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
void start();

export { app, io, engine };
