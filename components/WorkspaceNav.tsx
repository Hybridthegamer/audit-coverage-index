import Link from "next/link";

import { logout } from "@/app/workspace/actions";

/**
 * The private workspace nav. Mirrors the public SiteNav's proportions (52px, so
 * the dense table's sticky header offset still lines up) but is unmistakably the
 * private side: a "PRIVATE" brand suffix, a link back to the queue, and a logout
 * button wired to the server action. `page` is the right-hand you-are-here slug.
 */
export function WorkspaceNav({ page }: { page: string }) {
  return (
    <nav className="bam-nav">
      <Link
        href="/workspace"
        className="bam-nav-brand"
        style={{ textDecoration: "none" }}
      >
        AUDIT COVERAGE · WORKSPACE
      </Link>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--bam-space-lg)",
        }}
      >
        <span className="bam-nav-page">{page}</span>
        <form action={logout} style={{ display: "inline" }}>
          <button
            type="submit"
            className="bam-nav-page"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "var(--bam-cream-40)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            SIGN OUT
          </button>
        </form>
      </span>
    </nav>
  );
}
