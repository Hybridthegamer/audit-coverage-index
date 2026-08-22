import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Wraps every /workspace route — the login page and, nested below the (app)
 * route group, the authenticated pages. Its only job is metadata: this whole
 * subtree is private and must never be indexed. robots.txt disallows
 * /workspace as well; this is the in-page half of the same rule.
 *
 * The middleware (middleware.ts) is what actually enforces auth. This layout
 * assumes nothing about the session — it renders for the signed-out login page
 * too. The authenticated shell (nav, logout) lives in (app)/layout.tsx so it
 * never wraps the login form.
 */
export const metadata: Metadata = {
  title: {
    default: "Workspace",
    template: "%s · Workspace",
  },
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return children;
}
