import { z } from "zod";
import { getDb } from "../db.js";
import { config } from "../config.js";
import { sha256Hex } from "../util.js";
import { checkContent, shingles, similarity } from "./safety.js";
import { seedLibrary, wouldYouRather, thisOrThat, wordAssociationWords, knowMeQuestions, guessStatements, storyOpeners } from "./library.js";
import { makeProvider, type GeneratedItem } from "./provider.js";
import { insertContentItem, insertBatch, updateBatch, publishBatch } from "../store.js";

/**
 * Weekly content pipeline.
 *   schedule (cron) -> provider.generate(3000-4000)
 *   -> validate -> safety filter -> dedup (exact + near) -> categorize
 *   -> persist as a batch -> publish atomically
 * Any failure aborts publish; the previously published set stays live.
 */

const itemSchema = z.object({
  kind: z.enum(["truth", "dare"]),
  category: z.string().min(2).max(40),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  body: z.string().min(12).max(300),
  mediaPolicy: z.enum(["none", "optional", "required"]),
  mediaKinds: z.array(z.enum(["photo", "video", "voice", "drawing", "text"])).max(2),
});

export interface PipelineOptions {
  weekKey?: string;
  force?: boolean;
  batchSize?: number;
}

export function weekKeyFor(date = new Date()): string {
  // ISO week key, e.g. 2026-W39
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

let pipelineRunning = false; // single-process mutex (see docs for multi-node note)

export async function runWeeklyPipeline(opts: PipelineOptions = {}): Promise<{
  ok: boolean;
  batchId?: string;
  accepted: number;
  reason?: string;
}> {
  if (pipelineRunning) {
    return { ok: false, accepted: 0, reason: "pipeline already running" };
  }
  pipelineRunning = true;
  try {
    return await runWeeklyPipelineInner(opts);
  } finally {
    pipelineRunning = false;
  }
}

async function runWeeklyPipelineInner(opts: PipelineOptions = {}): Promise<{
  ok: boolean;
  batchId?: string;
  accepted: number;
  reason?: string;
}> {
  const weekKey = opts.weekKey ?? weekKeyFor();
  const db = getDb();

  // Already published this week? Skip unless forced (manual regeneration).
  const existing = db.prepare(`SELECT id, status FROM weekly_batches WHERE week_key = ?`).get(weekKey) as
    | { id: string; status: string }
    | undefined;
  if (existing && existing.status === "published" && !opts.force) {
    return { ok: true, batchId: existing.id, accepted: 0, reason: "already published" };
  }

  const batchSize = opts.batchSize ?? config.contentBatchSize;
  const provider = makeProvider();

  // If this week failed earlier, clean its rows BEFORE inserting the new batch
  // (week_key is UNIQUE). Items are re-inserted fresh; unpublished leftovers
  // from a threshold-failed run are removed here so a retry starts clean but
  // previously PUBLISHED items are never touched.
  if (existing && existing.status === "failed") {
    db.prepare(`DELETE FROM content_items WHERE batch_id = ? AND published = 0`).run(existing.id);
    db.prepare(`DELETE FROM weekly_batches WHERE id = ?`).run(existing.id);
  } else if (existing && existing.status !== "published") {
    db.prepare(`DELETE FROM content_items WHERE batch_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM weekly_batches WHERE id = ?`).run(existing.id);
  }

  const batchId = insertBatch(weekKey, provider.name, batchSize);
  console.log(`[content] batch ${batchId} (${weekKey}) starting with provider ${provider.name}`);

  try {

    updateBatch(batchId, { status: "generating" });
    const generated = await provider.generate(batchSize);
    if (!generated.length) throw new Error("provider returned no items");

    updateBatch(batchId, { status: "validating" });

    // ---- validate ----
    const valid: GeneratedItem[] = [];
    let rejected = 0;
    for (const item of generated) {
      const parsed = itemSchema.safeParse(item);
      if (!parsed.success) {
        rejected++;
        continue;
      }
      valid.push(parsed.data);
    }

    // ---- safety ----
    let safetyRejected = 0;
    const safe: GeneratedItem[] = [];
    for (const item of valid) {
      const verdict = checkContent(item.body);
      if (!verdict.ok) {
        safetyRejected++;
        continue;
      }
      safe.push(item);
    }

    // ---- dedup (exact hash + near-dup shingles) ----
    // Exact hashes are blocked forever by the UNIQUE constraint. Near-dups are
    // checked against the last 14 days, so genuinely-distinct items publish
    // weekly while same-week siblings can't slip through.
    const seenHashes = new Set<string>();
    const recent = db
      .prepare(
        `SELECT id, body FROM content_items
         WHERE created_at > ? AND body IS NOT NULL
         ORDER BY created_at DESC LIMIT 20000`,
      )
      .all(Date.now() - 1000 * 60 * 60 * 24 * 14) as Array<{ id: string; body: string }>;
    const recentShingles = recent.map((r) => ({ id: r.id, sh: shingles(r.body) }));

    let duplicates = 0;
    const accepted: GeneratedItem[] = [];
    for (const item of safe) {
      const hash = sha256Hex(`${item.kind}::${item.body.toLowerCase().replace(/\s+/g, " ").trim()}`);
      if (seenHashes.has(hash)) {
        duplicates++;
        continue;
      }
      const sh = shingles(item.body);
      const nearDup = recentShingles.some((r) => similarity(sh, r.sh) > 0.7);
      if (nearDup) {
        duplicates++;
        continue;
      }
      seenHashes.add(hash);
      recentShingles.push({ id: "", sh });
      accepted.push(item);
    }

    // ---- persist ----
    const tx = db.transaction(() => {
      for (const item of accepted) {
        insertContentItem({
          batchId,
          kind: item.kind,
          category: item.category,
          difficulty: item.difficulty,
          body: item.body,
          options: null,
          mediaPolicy: item.mediaPolicy,
          mediaKinds: item.mediaKinds,
          contentHash: sha256Hex(`${item.kind}::${item.body.toLowerCase().replace(/\s+/g, " ").trim()}`),
          status: "active",
          published: false,
        });
      }
    });
    tx();

    updateBatch(batchId, {
      status: "ready",
      acceptedCount: accepted.length,
      rejectedCount: rejected,
      duplicateCount: duplicates,
      safetyRejected,
      error: null,
    });

    // ---- publish gate ----
    // The new batch must add meaningful volume (floor 400) before it replaces
    // the live set. Prevents thin batches from wiping a healthy library on a
    // bad generation run. (A full static run yields ~2,000+; AI runs 3,000+.)
    const minRequired = 400;
    if (accepted.length < minRequired) {
      // Threshold failure: persist the batch as ready-but-unpublished so a
      // retry can succeed even if the provider keeps yielding near-dups of the
      // current live set (the retry's provider run is fresh; previously stored
      // rows keep their batch_id and are NOT deleted).
      updateBatch(batchId, { status: "failed", error: `accepted ${accepted.length} < required ${minRequired}` });
      return { ok: false, batchId, accepted: accepted.length, reason: "validation threshold" };
    }

    publishBatch(batchId);
    console.log(`[content] batch ${batchId} published: ${accepted.length} items`);
    return { ok: true, batchId, accepted: accepted.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateBatch(batchId, { status: "failed", error: message });
    console.error(`[content] batch ${batchId} failed: ${message}`);
    return { ok: false, batchId, accepted: 0, reason: message };
  }
}

/** Ensure a published pool exists at first boot; ingest the seed library if empty. */
export function ensureContentBootstrapped(): void {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM content_items WHERE published = 1`).get() as { c: number };
  if (row.c > 0) return;
  console.log("[content] empty pool — ingesting curated seed library");
  const batchId = insertBatch(weekKeyFor(), "bootstrap", 0);
  const tx = db.transaction(() => {
    for (const item of seedLibrary) {
      insertContentItem({
        batchId,
        kind: item.kind,
        category: item.category,
        difficulty: item.difficulty,
        body: item.body,
        options: null,
        mediaPolicy: item.mediaPolicy ?? "none",
        mediaKinds: item.mediaKinds ?? [],
        contentHash: sha256Hex(`${item.kind}::${item.body.toLowerCase().replace(/\s+/g, " ").trim()}`),
        status: "active",
        published: true,
      });
    }
    for (const pair of wouldYouRather) {
      insertContentItem({
        batchId, kind: "choice_pair", category: "would_you_rather", difficulty: 1,
        body: null, options: pair, contentHash: sha256Hex(`wyr::${pair.join("|").toLowerCase()}`),
        status: "active", published: true,
      });
    }
    for (const pair of thisOrThat) {
      insertContentItem({
        batchId, kind: "choice_pair", category: "this_or_that", difficulty: 1,
        body: null, options: pair, contentHash: sha256Hex(`tot::${pair.join("|").toLowerCase()}`),
        status: "active", published: true,
      });
    }
    for (const w of wordAssociationWords) {
      insertContentItem({
        batchId, kind: "word", category: "association", difficulty: 1,
        body: w, contentHash: sha256Hex(`word::${w.toLowerCase()}`), status: "active", published: true,
      });
    }
    for (const q of knowMeQuestions) {
      insertContentItem({
        batchId, kind: "prompt", category: "know_me", difficulty: 1,
        body: q, contentHash: sha256Hex(`km::${q.toLowerCase()}`), status: "active", published: true,
      });
    }
    for (const s of guessStatements) {
      insertContentItem({
        batchId, kind: "statement", category: "guess_the_player", difficulty: 2,
        body: s, contentHash: sha256Hex(`gtp::${s.toLowerCase()}`), status: "active", published: true,
      });
    }
    for (const s of storyOpeners) {
      insertContentItem({
        batchId, kind: "prompt", category: "story", difficulty: 1,
        body: s, contentHash: sha256Hex(`story::${s.toLowerCase()}`), status: "active", published: true,
      });
    }
  });
  tx();
  updateBatch(batchId, { status: "published", acceptedCount: seedLibrary.length, publishedAt: Date.now() });
  console.log("[content] bootstrap complete");
}
