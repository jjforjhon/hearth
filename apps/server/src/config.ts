import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Server configuration. Secrets come from the environment (.env.local, git-ignored).
 * In development (NODE_ENV !== "production"), missing secrets are replaced with
 * ephemeral random values so local runs work out of the box (logged loudly).
 * In production a missing secret is a hard startup error — fail closed.
 */

function loadEnvFile(): void {
  const candidate = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(candidate)) return;
  for (const rawLine of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}
loadEnvFile();

function requiredSecret(name: string): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing required env var: ${name}`);
  }
  const ephemeral = crypto.randomBytes(32).toString("hex");
  console.warn(
    `[config] ${name} not set — using an ephemeral dev secret. ` +
      `Sessions/signed URLs will not survive restarts. Set it in .env.local.`,
  );
  return ephemeral;
}

function envPort(): number {
  const raw = process.env.HEARTH_PORT || process.env.PORT || "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 4318;
}

export const config = {
  port: envPort(),
  publicOrigin: (
    process.env.PUBLIC_ORIGIN ??
    // Render injects RENDER_EXTERNAL_URL automatically — zero-config prod origin.
    process.env.RENDER_EXTERNAL_URL ??
    "http://localhost:5173"
  ).replace(/\/+$/, ""),
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  isProduction: process.env.NODE_ENV === "production",

  // Remote libSQL/Turso database. When set, all persistent data lives in the
  // cloud DB (ephemeral-host safe). Empty = local SQLite file (development).
  libsqlUrl: process.env.LIBSQL_URL ?? "",
  libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN ?? "",

  // Backblaze B2 object storage for media. When set, uploads go to the private
  // bucket; otherwise files are stored under DATA_DIR/media (development).
  b2: {
    keyId: process.env.B2_KEY_ID ?? "",
    appKey: process.env.B2_APP_KEY ?? "",
    bucketId: process.env.B2_BUCKET_ID ?? "",
    bucketName: process.env.B2_BUCKET_NAME ?? "",
    region: process.env.B2_S3_REGION ?? "",
  },

  // Shared secret for the GitHub Actions weekly-content caller. The cron
  // endpoint fails closed when this is unset in production.
  cronSecret: process.env.HEARTH_CRON_SECRET ?? "",
  // Render free instances sleep; in-process cron is unreliable there.
  // Set HEARTH_DISABLE_CRON=1 on ephemeral hosts and schedule via GitHub Actions.
  disableInProcessCron: process.env.HEARTH_DISABLE_CRON === "1",

  sessionSecret: requiredSecret("SESSION_SECRET"),
  mediaSigningSecret: requiredSecret("MEDIA_SIGNING_SECRET"),
  adminUsernames: (process.env.PLATFORM_ADMIN_USERNAMES ?? "admin")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  contentCron: process.env.CONTENT_CRON || "0 3 * * 0",
  contentBatchSize: Math.min(Math.max(Number(process.env.CONTENT_BATCH_SIZE || 3500), 100), 4000),

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 0),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Hearth <no-reply@hearth.example>",
  },

  cookieName: "hearth_session",
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30, // 30 days
  sessionIdleMs: 1000 * 60 * 60 * 24 * 7, // revoke after 7 idle days
};

export const usingRemoteDb = (): boolean => config.libsqlUrl.length > 0;
export const usingObjectStorage = (): boolean =>
  config.b2.keyId !== "" &&
  config.b2.appKey !== "" &&
  config.b2.bucketId !== "" &&
  config.b2.bucketName !== "" &&
  config.b2.region !== "";
