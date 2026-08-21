import Link from "next/link";

/**
 * The sticky editorial nav. `page` is the right-hand slug that tells you where
 * you are — the left brand mark always returns home.
 *
 * The dense table's sticky `thead` is offset by the 52px nav height (see
 * `.bam-table thead th` in globals.css); if this bar's height changes, that
 * offset has to change with it.
 */
export function SiteNav({ page }: { page: string }) {
  return (
    <nav className="bam-nav">
      <Link
        href="/"
        className="bam-nav-brand"
        style={{ textDecoration: "none" }}
      >
        AUDIT COVERAGE INDEX
      </Link>
      <span className="bam-nav-page">{page}</span>
    </nav>
  );
}
