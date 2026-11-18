/**
 * HMAC-SHA256 request signing shared by both directions of the
 * Convex <-> n8n integration.
 *
 *   X-LendLoop-Timestamp: <unix seconds>
 *   X-LendLoop-Signature: v1=<hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))>
 *
 * The timestamp is part of the signed string, so an attacker cannot
 * re-use an old signature with a fresh timestamp. Receivers reject
 * requests older than MAX_SKEW_SECONDS (replay protection).
 *
 * Uses Web Crypto only, so it runs in the default Convex runtime.
 */

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const EVENT_ID_HEADER = "X-LendLoop-Event-Id";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(sig);
}

export async function signPayload(
  secret: string,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(nowSeconds);
  const hex = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return { timestamp, signature: `v1=${hex}` };
}

/** Compare two strings in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

export async function verifySignature(
  secret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "missing" };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = `v1=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
  return timingSafeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
