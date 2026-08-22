import { createHmac } from "node:crypto";

import { SESSION_MAX_AGE } from "@/lib/auth";

/**
 * Node-runtime token minting. Split out from lib/auth.ts (which must stay
 * edge-safe for middleware) because this uses node:crypto to sign
 * SYNCHRONOUSLY. That matters: the login server action mints a token and then
 * sets a cookie, and an intervening await of WebCrypto drops Next's request
 * scope, making cookies() throw. A synchronous HMAC keeps the whole action on
 * one tick, so cookies() stays in scope.
 *
 * The output format is identical to what lib/auth.ts verifies —
 * `<expiryMs>.<base64url(hmacSha256(expiryMs))>` — so the edge WebCrypto
 * verifier validates tokens minted here. Only ever imported by Node code.
 */

function secret(): string {
  const value = process.env.WORKSPACE_SESSION_SECRET;
  if (!value) {
    throw new Error("WORKSPACE_SESSION_SECRET is not set — required to gate /workspace");
  }
  return value;
}

/** Mint a session token: `<expiryMs>.<hmac(expiryMs)>`. Synchronous by design. */
export function createSessionToken(): string {
  const expiry = String(Date.now() + SESSION_MAX_AGE * 1000);
  // Buffer's "base64url" is RFC 4648 §5, unpadded — the same alphabet the
  // WebCrypto verifier in lib/auth.ts produces and compares against.
  const signature = createHmac("sha256", secret()).update(expiry).digest("base64url");
  return `${expiry}.${signature}`;
}
