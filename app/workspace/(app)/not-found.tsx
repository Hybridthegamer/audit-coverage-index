import Link from "next/link";

import { WorkspaceNav } from "@/components/WorkspaceNav";

/**
 * The private 404 — what an unknown or archived target id renders. Kept inside
 * the (app) group so it wears the workspace shell (nav + sign out) instead of
 * the public SiteNav that the global app/not-found.tsx uses.
 */
export default function WorkspaceNotFound() {
  return (
    <>
      <WorkspaceNav page="404" />
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
          <div className="bam-mid">
            <p className="bam-eyebrow">404 · NO SUCH TARGET</p>
            <h1 className="bam-headline">
              Nothing <em>here</em>.
            </h1>
            <p
              className="bam-body"
              style={{ maxWidth: "44ch", marginTop: "var(--bam-space-lg)" }}
            >
              That deployment id does not exist, or the protocol has been
              archived out of the workspace.
            </p>
            <div style={{ marginTop: "var(--bam-space-xl)" }}>
              <Link href="/workspace" className="bam-btn-ghost">
                Back to the queue
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
