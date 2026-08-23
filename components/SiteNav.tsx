import Link from "next/link";

/**
 * The sticky editorial nav. `page` is the right-hand slug that tells you where
 * you are — the left brand mark always returns home.
 *
 * `action` is the optional call-to-action that sits after the slug. Only the
 * landing page passes it (the workspace door); the other pages stay a plain
 * brand + slug bar, so this does not put a private-side link on every page.
 *
 * The dense table's sticky `thead` is offset by the 52px nav height (see
 * `.bam-table thead th` in globals.css); if this bar's height changes, that
 * offset has to change with it.
 */
export function SiteNav({
  page,
  action,
}: {
  page: string;
  action?: { href: string; label: string };
}) {
  return (
    <nav className="bam-nav">
      <Link
        href="/"
        className="bam-nav-brand"
        style={{ textDecoration: "none" }}
      >
        AUDIT COVERAGE INDEX
      </Link>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--bam-space-md)",
        }}
      >
        <span className="bam-nav-page">{page}</span>
        {action ? (
          <Link href={action.href} className="bam-nav-link">
            {action.label}
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
