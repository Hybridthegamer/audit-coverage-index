import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, SESSION_PATH } from "@/lib/auth";

/**
 * Logout endpoint. A route handler for the same reason as /workspace/auth —
 * clearing the session cookie belongs on the Response. The sign-out control in
 * the workspace nav POSTs here. This path is NOT exempt from the middleware
 * gate, which is fine: only a signed-in user is ever shown the button, and a
 * signed-out POST here simply gets bounced to login.
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(
    new URL("/workspace/login", req.nextUrl.origin),
    { status: 303 },
  );
  res.cookies.set(SESSION_COOKIE, "", { path: SESSION_PATH, maxAge: 0 });
  return res;
}
