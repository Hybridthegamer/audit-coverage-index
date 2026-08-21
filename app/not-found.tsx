import Link from "next/link";

import { SiteNav } from "@/components/SiteNav";

/**
 * 404. Also what an unpublished or archived protocol slug renders — the public
 * query layer returns null for those, and the detail page calls notFound(), so
 * "not published" and "does not exist" are deliberately indistinguishable from
 * outside.
 */
export default function NotFound() {
  return (
    <>
      <SiteNav page="404" />
      <main className="bam-page">
        <section
          className="bam-pad-x"
          style={{
            minHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div className="bam-wide">
            <p className="bam-eyebrow">404 · NOT IN THE INDEX</p>
            <h1 className="bam-headline">
              Nothing <em>here</em>.
            </h1>
            <p
              className="bam-body"
              style={{ maxWidth: "44ch", marginTop: "var(--bam-space-lg)" }}
            >
              This page does not exist, or the protocol it described is not
              published.
            </p>
            <div style={{ marginTop: "var(--bam-space-xl)" }}>
              <Link href="/index" className="bam-btn-ghost">
                Back to the index
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
