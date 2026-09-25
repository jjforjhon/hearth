import crypto from "node:crypto";

/**
 * Backblaze B2 storage adapter — S3-compatible API with AWS SigV4 signing.
 * (The native b2_upload_file pod endpoints returned empty-body 401s from some
 * networks; the S3 endpoint is a single stable host per region and signs with
 * the application key directly — no upload-token round-trips.)
 *
 * Free tier: 10 GB storage, free egress, no credit card. Private bucket:
 * downloads happen ONLY through the server's authorized `/api/media/file/:id`
 * route, which fetches from B2 with SigV4 and streams to the user. Direct
 * bucket URLs never work for outsiders.
 */

const KEY_ID = process.env.B2_KEY_ID ?? "";
const APP_KEY = process.env.B2_APP_KEY ?? "";
const BUCKET = process.env.B2_BUCKET_NAME ?? "";
const REGION = process.env.B2_S3_REGION ?? "";

function host(): string {
  return `s3.${REGION}.backblazeb2.com`;
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

interface SigV4Headers {
  Authorization: string;
  "x-amz-date": string;
  "x-amz-content-sha256": string;
  "x-amz-content-type"?: string;
}

function sigv4Headers(method: string, objectKey: string, payloadHash: string): SigV4Headers {
  const amzDate = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:-]/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const h = host();
  const canonicalUri = `/${BUCKET}/${objectKey
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${h}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${APP_KEY}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
}

function objectKey(storagePath: string): string {
  // storage_path stored in DB is the object key in B2 mode (e.g. "media/med_x.png")
  return storagePath.replace(/^\/+/, "");
}

export async function b2Put(storagePath: string, buf: Buffer, mime: string): Promise<void> {
  const payloadHash = sha256Hex(buf);
  const headers = sigv4Headers("PUT", objectKey(storagePath), payloadHash);
  const res = await fetch(`https://${host()}/${BUCKET}/${objectKey(storagePath)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": mime, "Content-Length": String(buf.length) },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`B2 S3 put failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/**
 * Authorized server-side download. Returns null if the object does not exist.
 * Never returns a public URL — bytes are streamed through the API route so the
 * room-membership/owner checks in routes/media.ts always apply.
 */
export async function b2Get(storagePath: string): Promise<Buffer | null> {
  const emptyHash = sha256Hex("");
  const headers = sigv4Headers("GET", objectKey(storagePath), emptyHash);
  const res = await fetch(`https://${host()}/${BUCKET}/${objectKey(storagePath)}`, {
    method: "GET",
    headers,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 S3 get failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function b2Delete(storagePath: string): Promise<void> {
  const emptyHash = sha256Hex("");
  const headers = sigv4Headers("DELETE", objectKey(storagePath), emptyHash);
  const res = await fetch(`https://${host()}/${BUCKET}/${objectKey(storagePath)}`, {
    method: "DELETE",
    headers,
  });
  // 204 = deleted; 404 = already gone; anything else is an error.
  if (!res.ok && res.status !== 404) {
    throw new Error(`B2 S3 delete failed (${res.status})`);
  }
}

/**
 * Object key used as the DB `storage_path` value in B2 mode.
 * Flat namespace under media/, extension preserved.
 */
export function b2KeyFor(id: string, ext: string): string {
  return `media/${id}.${ext}`;
}
