import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Backblaze B2 object storage adapter (S3-compatible API, no SDK dependency).
 *
 * Free tier: 10 GB storage, free egress, no credit card. Private bucket:
 * downloads happen ONLY through the server's authorized `/api/media/file/:id`
 * route, which fetches from B2 with a short-lived auth token and streams to
 * the user. Direct bucket URLs never work for outsiders.
 *
 * Selected over Render's ephemeral disk (files vanish on every spin-down/
 * redeploy) and over signed-URL-to-bucket designs (would leak private media
 * to anyone holding the URL — breaks the verified IDOR guarantees).
 */

interface B2Auth {
  token: string;
  s3ApiUrl: string;
  apiUrl: string;
  expiresAt: number;
}

let cachedAuth: B2Auth | null = null;

async function b2Auth(): Promise<B2Auth> {
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 60_000) return cachedAuth;
  const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.b2.keyId}:${config.b2.appKey}`).toString("base64")}`,
    },
  });
  if (!res.ok) throw new Error(`B2 auth failed (${res.status})`);
  const data = (await res.json()) as {
    authorizationToken: string;
    apiUrl: string;
    s3ApiUrl: string;
  };
  cachedAuth = {
    token: data.authorizationToken,
    apiUrl: data.apiUrl,
    s3ApiUrl: data.s3ApiUrl,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000, // tokens last 24h
  };
  return cachedAuth;
}

function objectKey(storagePath: string): string {
  // storage_path stored in DB is the object key for B2 mode (e.g. "media/med_x.png")
  return storagePath.replace(/^\/+/, "");
}

export async function b2Put(storagePath: string, buf: Buffer, mime: string): Promise<void> {
  const auth = await b2Auth();
  const urlRes = await fetch(
    `${auth.apiUrl}/b2api/v3/b2_get_upload_url?bucketId=${encodeURIComponent(config.b2.bucketId)}`,
    { headers: { Authorization: auth.token } },
  );
  if (!urlRes.ok) throw new Error(`B2 get_upload_url failed (${urlRes.status})`);
  const { uploadUrl, authorizationToken } = (await urlRes.json()) as {
    uploadUrl: string;
    authorizationToken: string;
  };
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(objectKey(storagePath)),
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "X-Bz-Content-Sha1": sha1,
    },
    body: new Uint8Array(buf),
  });
  if (!up.ok) throw new Error(`B2 upload failed (${up.status})`);
}

/**
 * Authorized server-side download. Returns null if the object does not exist.
 * Never returns a public URL — bytes are streamed through the API route so the
 * room-membership/owner checks in routes/media.ts always apply.
 */
export async function b2Get(storagePath: string): Promise<Buffer | null> {
  const auth = await b2Auth();
  const url = `${auth.apiUrl}/b2api/v3/b2_download_file_by_name?bucketId=${encodeURIComponent(
    config.b2.bucketId,
  )}&fileName=${encodeURIComponent(objectKey(storagePath))}`;
  const res = await fetch(url, { headers: { Authorization: auth.token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function b2Delete(storagePath: string): Promise<void> {
  const auth = await b2Auth();
  // Look up fileId by name first (delete requires the fileId).
  const list = await fetch(`${auth.apiUrl}/b2api/v3/b2_list_file_names`, {
    method: "POST",
    headers: { Authorization: auth.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      bucketId: config.b2.bucketId,
      startFileName: objectKey(storagePath),
      maxFileCount: 1,
    }),
  });
  if (!list.ok) throw new Error(`B2 list failed (${list.status})`);
  const { files } = (await list.json()) as { files: Array<{ fileName: string; fileId: string }> };
  const match = files.find((f) => f.fileName === objectKey(storagePath));
  if (!match) return; // already gone
  await fetch(`${auth.apiUrl}/b2api/v3/b2_delete_file_version`, {
    method: "POST",
    headers: { Authorization: auth.token, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: match.fileName, fileId: match.fileId }),
  });
}

/**
 * Object key used as the DB `storage_path` value in B2 mode.
 * Content-addressable style, flat namespace, extension preserved.
 */
export function b2KeyFor(id: string, ext: string): string {
  return `media/${id}.${ext}`;
}
