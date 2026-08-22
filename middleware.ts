import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * The workspace gate. Everything under /workspace is private, single-user, and
 * unindexed; this middleware is the boundary that enforces it. It runs on the
 * Edge runtime, which is why lib/auth verifies the session with Web Crypto
 * rather than Node's `crypto` module.
 *
 * /workspace/login is the one exception — an unauthenticated visitor must be
 * able to reach it, and the login server action POSTs back to that same path.
 * Everything else requires a valid session cookie or is bounced to the login
 * page with a sanitized `?next` so the visitor lands where they were headed.
 *
 * This is defence at the request boundary; robots.txt already disallows
 * /workspace as defence in depth, and the pages themselves are force-dynamic so
 * nothing private is ever prerendered or ISR-cached.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // The login page and its server-action POST must stay reachable while signed
  // out. Nothing sensitive is rendered there.
  if (pathname === "/workspace/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/workspace/login";
  url.search = "";
  const intended = pathname + search;
  // Only round-trip a `next` when it is a real destination past the queue root.
  if (intended && intended !== "/workspace") {
    url.searchParams.set("next", intended);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/workspace", "/workspace/:path*"],
};
