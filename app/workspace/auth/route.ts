import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SESSION_PATH,
  verifyPassword,
} from "@/lib/auth";
import { createSessionToken } from "@/lib/auth-node";

/**
 * Login endpoint. A route handler, not a server action, because it sets the
 * session cookie: setting a cookie belongs on a Response, and doing it here
 * (res.cookies.set) sidesteps the request-scope pitfalls of cookies() inside a
 * server action. The login form POSTs here as a plain HTML form, so sign-in
 * works with JavaScript disabled.
 *
 * Middleware exempts this path (like /workspace/login) so a signed-out visitor
 * can reach it.
 */

function sanitizeNext(next: string): string {
  // Only ever redirect to an internal /workspace path — no open redirects.
  if (next.startsWith("/workspace") && !next.startsWith("//")) return next;
  return "/workspace";
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = sanitizeNext(String(form.get("next") ?? ""));
  const { origin } = req.nextUrl;

  if (!password || !verifyPassword(password)) {
    const back = new URL("/workspace/login", origin);
    back.searchParams.set("error", "1");
    if (next !== "/workspace") back.searchParams.set("next", next);
    return NextResponse.redirect(back, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(next, origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SESSION_PATH,
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
