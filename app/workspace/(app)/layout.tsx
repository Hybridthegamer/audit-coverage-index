import type { ReactNode } from "react";

/**
 * The authenticated workspace shell. This route group — (app) — holds every
 * page that requires a session: the queue and the target detail views. The
 * login page sits outside it, so it never inherits this shell.
 *
 * The per-page WorkspaceNav lives in each page (it takes a you-are-here label),
 * so this layout is just the page frame. Reaching it at all means the
 * middleware already admitted a valid session.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
