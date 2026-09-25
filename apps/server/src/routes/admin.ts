import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { config } from "../config.js";
import {
  listBatches,
  searchContentItems,
  disableContentItem,
  enableContentItem,
  rollbackToBatch,
  contentPoolStats,
  audit,
} from "../store.js";
import { runWeeklyPipeline } from "../content/pipeline.js";

/** Admin-only content management. Every handler re-verifies admin server-side. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: { currentUser?: { id: string; isPlatformAdmin: boolean } }, reply: { code: (n: number) => unknown }) => {
    const me = req.currentUser;
    if (!me) {
      reply.code(401);
      return null;
    }
    if (!me.isPlatformAdmin) {
      reply.code(403);
      return null;
    }
    return me;
  };

  // Scheduler endpoint for GitHub Actions (no user session exists there).
  // Fails closed: 503 unless HEARTH_CRON_SECRET is configured; bearer value is
  // compared in constant time. Idempotent per week via weekly_batches.week_key.
  app.post(
    "/cron/weekly",
    { config: { rateLimit: { max: 4, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (!config.cronSecret) {
        return reply.code(503).send({ error: "Weekly trigger not configured" });
      }
      const auth = req.headers.authorization ?? "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const a = Buffer.from(provided);
      const b = Buffer.from(config.cronSecret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return reply.code(401).send({ error: "Invalid scheduler token" });
      }
      const result = await runWeeklyPipeline();
      if (!result.ok) {
        return reply.code(502).send({ error: result.reason ?? "weekly pipeline failed" });
      }
      // Idempotent: a second trigger in the same week returns
      // { reason: "already published" } without duplicating content.
      return result;
    },
  );

  app.get("/batches", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    return { batches: listBatches(50), pool: contentPoolStats() };
  });

  app.get("/content", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const q = z
      .object({
        kind: z.enum(["truth", "dare", "statement", "prompt", "word", "choice_pair"]).optional(),
        status: z.enum(["active", "disabled", "pending"]).optional(),
        search: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query ?? {});
    return { items: searchContentItems(q) };
  });

  app.post("/content/:id/disable", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    disableContentItem(id);
    audit(me.id, "admin.content_disabled", id);
    return { ok: true };
  });

  app.post("/content/:id/enable", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    enableContentItem(id);
    audit(me.id, "admin.content_enabled", id);
    return { ok: true };
  });

  app.post("/batches/:id/rollback", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    rollbackToBatch(id);
    audit(me.id, "admin.batch_rollback", id);
    return { ok: true };
  });

  app.post("/batches/:id/regenerate", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const batch = getDb().prepare(`SELECT week_key FROM weekly_batches WHERE id = ?`).get(id) as
      | { week_key: string }
      | undefined;
    if (!batch) return reply.code(404).send({ error: "Batch not found" });
    // Run async; admin can poll /admin/batches for status.
    void runWeeklyPipeline({ weekKey: batch.week_key, force: true }).catch((err) =>
      app.log.error({ err }, "manual regeneration failed"),
    );
    audit(me.id, "admin.batch_regenerate", id);
    return { ok: true, queued: true };
  });

  app.get("/reports", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const rows = getDb()
      .prepare(
        `SELECT r.*, ru.username AS reporter_username FROM reports r
         LEFT JOIN users ru ON ru.id = r.reporter_id
         ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`,
      )
      .all() as Array<Record<string, unknown>>;
    return { reports: rows };
  });

  app.post("/reports/:id/resolve", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const parsed = z.object({ action: z.enum(["resolve", "dismiss"]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    getDb()
      .prepare(`UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
      .run(parsed.data.action === "resolve" ? "resolved" : "dismissed", me.id, Date.now(), id);
    audit(me.id, `admin.report_${parsed.data.action}`, id);
    return { ok: true };
  });

  app.post("/users/:userId/suspend", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(req.params);
    const parsed = z.object({ suspended: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    if (userId === me.id) return reply.code(400).send({ error: "You cannot suspend yourself" });
    getDb().prepare(`UPDATE users SET is_suspended = ? WHERE id = ?`).run(parsed.data.suspended ? 1 : 0, userId);
    if (parsed.data.suspended) {
      getDb().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    }
    audit(me.id, parsed.data.suspended ? "admin.user_suspended" : "admin.user_unsuspended", userId);
    return { ok: true };
  });

  app.get("/audit", async (req, reply) => {
    const me = await requireAdmin(req, reply);
    if (!me) return;
    const rows = getDb()
      .prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200`)
      .all() as Array<Record<string, unknown>>;
    return { entries: rows };
  });
}
