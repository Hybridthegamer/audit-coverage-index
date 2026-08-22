"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SESSION_PATH,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth";

/**
 * The two workspace mutations: sign in, sign out. Both are server actions, so
 * the cookie is set from the server and the password never crosses back to the
 * client. There is no account creation — one researcher, one password in the
 * environment (WORKSPACE_PASSWORD).
 */

/**
 * Only ever redirect to an internal /workspace path, so a crafted `?next` can't
 * turn the login form into an open redirect off-site. Reject protocol-relative
 * (`//evil`) and anything outside the workspace.
 */
function sanitizeNext(next: string): string {
  if (next.startsWith("/workspace") && !next.startsWith("//")) return next;
  return "/workspace";
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(String(formData.get("next") ?? ""));

  if (!password || !verifyPassword(password)) {
    // Bounce back to the form with a flag (and preserve where they were going).
    const params = new URLSearchParams({ error: "1" });
    if (next !== "/workspace") params.set("next", next);
    redirect(`/workspace/login?${params.toString()}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SESSION_PATH,
    maxAge: SESSION_MAX_AGE,
  });

  redirect(next);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: SESSION_COOKIE, path: SESSION_PATH });
  redirect("/workspace/login");
}
