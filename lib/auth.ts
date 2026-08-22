/**
 * Single-user workspace auth. There is one researcher and one password; this is
 * a gate, not an identity system, so there is deliberately no users table (the
 * schema stays locked at 10 tables) and no session store. A login mints a
 * signed, expiring cookie; every /workspace request is admitted by verifying
 * that signature. Nothing here touches the database.
 *
 * Runtime-agnostic on purpose. It uses only Web Crypto (`crypto.subtle`) and
 * `TextEncoder`, both global in the Node runtime (login server action) AND the
 * Edge runtime (middleware). That is what lets middleware.ts and the login
 * action share one verifier instead of two that can drift apart.
 *
 * Two env secrets, both required, both server-only (never NEXT_PUBLIC_):
 *   WORKSPACE_PASSWORD        — the login secret, compared in constant time
 *   WORKSPACE_SESSION_SECRET  — HMAC key the session cookie is signed with
 * Rotating WORKSPACE_SESSION_SECRET invalidates every outstanding session.
 */

const enc = new TextEncoder();

/** Cookie name + scope. Path is /workspace so it is never sent to public routes. */
export const SESSION_COOKIE = "acx_session";
export const SESSION_PATH = "/workspace";
/** 14 days. The token carries its own expiry; the cookie maxAge mirrors it. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

function requireEnv(name: "WORKSPACE_PASSWORD" | "WORKSPACE_SESSION_SECRET"): string {
  // Static property access (not process.env[name]) so Next can inline it into
  // the Edge bundle where dynamic env lookups are not available.
  const value =
    name === "WORKSPACE_PASSWORD"
      ? process.env.WORKSPACE_PASSWORD
      : process.env.WORKSPACE_SESSION_SECRET;
  if (!value) {
    throw new Error(`${name} is not set — required to gate /workspace`);
  }
  return value;
}

/** URL-safe base64 with no padding — cookie-safe. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(requireEnv("WORKSPACE_SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64url(new Uint8Array(sig));
}

/**
 * Length-independent constant-time compare over UTF-8 bytes. Both the password
 * check and the signature check route through here so neither leaks via timing.
 * Folding the length difference into the accumulator keeps the loop bound off
 * the secret's length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** True when the submitted password matches WORKSPACE_PASSWORD. */
export function verifyPassword(input: string): boolean {
  return timingSafeEqual(input, requireEnv("WORKSPACE_PASSWORD"));
}

/** Mint a session token: `<expiryMs>.<hmac(expiryMs)>`. */
export async function createSessionToken(): Promise<string> {
  const expiry = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${expiry}.${await sign(expiry)}`;
}

/**
 * True when `token` is well-formed, unexpired, and correctly signed. Any
 * malformed, stale, or forged token fails closed. Safe to call with undefined.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expiry = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;

  const expected = await sign(expiry);
  return timingSafeEqual(signature, expected);
}
