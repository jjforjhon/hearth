import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDb } from "../db.js";
import { config, usingObjectStorage } from "../config.js";
import { hmacHex, newId, now, randomToken, timingSafeEqual } from "../util.js";
import { getRoomMember } from "../store.js";
import { b2Put, b2Get, b2Delete, b2KeyFor } from "../storage/b2.js";

const MEDIA_DIR = path.join(config.dataDir, "media");

const KIND_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,
  photo: 8 * 1024 * 1024,
  video: 40 * 1024 * 1024,
  voice: 8 * 1024 * 1024,
  drawing: 1 * 1024 * 1024,
};

/** Magic-byte sniffing results we accept, by declared kind. */
const KIND_MIMES: Record<string, string[]> = {
  avatar: ["image/jpeg", "image/png", "image/webp"],
  photo: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/webm", "video/mp4"],
  voice: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"],
  drawing: ["image/png"],
};

interface UploadTicket {
  userId: string;
  kind: string;
  roomId: string | null;
  sessionId: string | null;
  expiresAt: number;
}

// One-time upload tickets (in-memory; uploads are short-lived by design).
const tickets = new Map<string, UploadTicket>();

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  app.post(
    "/init",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z
      .object({
        kind: z.enum(["avatar", "photo", "video", "voice", "drawing"]),
        roomId: z.string().max(64).optional(),
        sessionId: z.string().max(64).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid upload request" });
    if (parsed.data.roomId && !getRoomMember(parsed.data.roomId, me.id)) {
      return reply.code(403).send({ error: "You are not in this room" });
    }
    const token = randomToken(24);
    tickets.set(token, {
      userId: me.id,
      kind: parsed.data.kind,
      roomId: parsed.data.roomId ?? null,
      sessionId: parsed.data.sessionId ?? null,
      expiresAt: now() + 10 * 60 * 1000,
    });
    // Opportunistic cleanup.
    for (const [k, v] of tickets) if (v.expiresAt < now()) tickets.delete(k);
    return { uploadToken: token, maxBytes: KIND_LIMITS[parsed.data.kind]! };
  });

  // Raw binary upload route. The global octet-stream parser delivers a Buffer;
  // content type is decided by magic-byte sniffing, never by the declared header.
  app.put("/upload/:token", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    const ticket = tickets.get(token);
    if (!ticket || ticket.expiresAt < now()) {
      tickets.delete(token);
      return reply.code(410).send({ error: "Upload session expired, start again" });
    }
    if (ticket.userId !== me.id) return reply.code(403).send({ error: "Not your upload session" });
    tickets.delete(token); // one-time use

    const limit = KIND_LIMITS[ticket.kind]!;
    const raw = req.body;
    const buf = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? Buffer.from(raw, "binary")
        : Buffer.concat([Buffer.from(String(raw ?? ""))]);
    if (buf.length === 0) return reply.code(400).send({ error: "Empty upload" });
    if (buf.length > limit) return reply.code(413).send({ error: "File too large" });

    const mime = sniffMime(buf);
    const allowed = KIND_MIMES[ticket.kind] ?? [];
    if (!mime || !allowed.includes(mime)) {
      return reply.code(415).send({ error: "That file type is not allowed for this upload" });
    }
    const id = newId("med");
    const ext = mime.split("/")[1]!.replace("jpeg", "jpg").split("+")[0]!;
    const storagePath = usingObjectStorage()
      ? b2KeyFor(id, ext)
      : path.join(MEDIA_DIR, `${id}.${ext}`);
    try {
      if (usingObjectStorage()) {
        await b2Put(storagePath, buf, mime);
      } else {
        fs.writeFileSync(storagePath, buf);
      }
    } catch (err) {
      req.log.error({ err }, "media upload storage failed");
      return reply.code(502).send({ error: "Media storage unavailable, try again" });
    }
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    getDb()
      .prepare(
        `INSERT INTO media (id, uploaded_by, room_id, kind, mime, size_bytes, sha256, storage_path, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'room', ?)`,
      )
      .run(id, me.id, ticket.roomId, ticket.kind, mime, buf.length, sha, storagePath, now());
    return { mediaId: id, url: `/api/media/file/${id}` };
  });

  app.get("/file/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params);
    const row = getDb().prepare(`SELECT * FROM media WHERE id = ?`).get(id) as
      | {
          id: string;
          uploaded_by: string;
          room_id: string | null;
          kind: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
          visibility: string;
        }
      | undefined;
    if (!row) return reply.code(404).send({ error: "Not found" });
    const me = req.currentUser;
    const sig = (req.query as { sig?: string }).sig;
    const exp = Number((req.query as { exp?: string }).exp ?? 0);
    const signedOk =
      sig && exp && exp > Date.now() &&
      timingSafeEqual(sig, hmacHex(config.mediaSigningSecret, `${id}.${exp}`));
    let authorized = false;
    if (signedOk) {
      authorized = true;
    } else if (me) {
      if (row.uploaded_by === me.id || me.isPlatformAdmin) authorized = true;
      else if (row.room_id && getRoomMember(row.room_id, me.id)) authorized = true;
    }
    if (!authorized) return reply.code(403).send({ error: "Not authorized" });
    if (usingObjectStorage()) {
      const data = await b2Get(row.storage_path);
      if (!data) return reply.code(404).send({ error: "Not found" });
      return reply
        .header("Content-Type", row.mime)
        .header("Content-Length", data.length)
        .header("Cache-Control", "private, max-age=86400")
        .header("X-Content-Type-Options", "nosniff")
        .send(data);
    }
    const stream = fs.createReadStream(row.storage_path);
    return reply
      .header("Content-Type", row.mime)
      .header("Content-Length", row.size_bytes)
      .header("Cache-Control", "private, max-age=86400")
      .header("X-Content-Type-Options", "nosniff")
      .send(stream);
  });

  app.get("/sign/:id", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params);
    const row = getDb().prepare(`SELECT * FROM media WHERE id = ?`).get(id) as
      | { uploaded_by: string; room_id: string | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: "Not found" });
    const authorized =
      row.uploaded_by === me.id || me.isPlatformAdmin || (row.room_id && getRoomMember(row.room_id, me.id));
    if (!authorized) return reply.code(403).send({ error: "Not authorized" });
    const exp = Date.now() + 15 * 60 * 1000;
    const sig = hmacHex(config.mediaSigningSecret, `${id}.${exp}`);
    return { url: `/api/media/file/${id}?sig=${sig}&exp=${exp}` };
  });

  app.delete("/:id", async (req, reply) => {
    const me = req.currentUser;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params);
    const row = getDb().prepare(`SELECT * FROM media WHERE id = ?`).get(id) as
      | { uploaded_by: string; storage_path: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "Not found" });
    if (row.uploaded_by !== me.id && !me.isPlatformAdmin) {
      return reply.code(403).send({ error: "Not authorized" });
    }
    if (usingObjectStorage()) {
      try {
        await b2Delete(row.storage_path);
      } catch (err) {
        req.log.warn({ err }, "B2 delete failed; removing DB record anyway");
      }
    } else {
      try {
        fs.unlinkSync(row.storage_path);
      } catch {
        /* already gone */
      }
    }
    getDb().prepare(`DELETE FROM media WHERE id = ?`).run(id);
    return { ok: true };
  });
}

/** Sniff real content type from magic bytes; never trust the declared Content-Type. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WAVE") return "audio/wave";
  if (buf.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  if (buf.slice(0, 4).toString("ascii") === "\x1aE\xdf\xa3") return "video/webm"; // EBML (webm/matroska)
  if (buf.slice(0, 3).toString("ascii") === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}
