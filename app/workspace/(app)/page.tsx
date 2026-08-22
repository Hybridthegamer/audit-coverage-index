import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { getQueue, summarizeQueue } from "@/db/queries/workspace";
import {
  chainLabel,
  formatDate,
  formatDrift,
  formatTvl,
  plural,
  queueStatusLabel,
  truncateAddress,
} from "@/lib/format";

/**
 * The research queue — every active target ranked for review. This is the
 * private mirror of the public /index: the same dense surface, but it sees
 * unpublished protocols and carries the private priority_score (computed at
 * query time, never stored) plus each target's queue status.
 *
 * force-dynamic: private data behind auth. Never prerender it, never ISR-cache
 * it — every load reflects the current DB and the current session.
 */
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const rows = await getQueue();
  const counts = summarizeQueue(rows);

  return (
    <>
      <WorkspaceNav page="QUEUE" />

      <main className="bam-page" data-surface="dense">
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-xl)",
          }}
        >
          <Reveal>
            <p className="bam-eyebrow">
              {plural(counts.total, "TARGET")} · {counts.open} OPEN ·{" "}
              {plural(counts.unpublished, "UNPUBLISHED")}
            </p>
            <h1 className="bam-headline">The queue.</h1>
            <p
              className="bam-body"
              style={{ maxWidth: "58ch", marginTop: "var(--bam-space-lg)" }}
            >
              Every tracked deployment, ranked by priority — coverage state
              first, then money at risk and how long the code has run unreviewed.
              Open targets lead; cleared and dropped ones settle to the bottom.
              Priority is a private research heuristic, not a published score.
            </p>
          </Reveal>
        </section>

        <section className="bam-pad-x" style={{ paddingBottom: "var(--bam-space-3xl)" }}>
          <Reveal>
            <div className="bam-table-scroll">
              <table className="bam-table">
                <caption
                  className="bam-eyebrow"
                  style={{ textAlign: "left", marginBottom: "var(--bam-space-sm)" }}
                >
                  RESEARCH QUEUE · RANKED
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Priority
                    </th>
                    <th scope="col">Target</th>
                    <th scope="col">Chain</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      TVL
                    </th>
                    <th scope="col">Coverage</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Drift
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.deploymentId}>
                      <td className="bam-cell-num">{row.priorityScore}</td>
                      <td>
                        <Link
                          href={`/workspace/targets/${row.deploymentId}`}
                          className="bam-cell-name"
                          style={{ textDecoration: "none" }}
                        >
                          {row.protocolName}
                        </Link>{" "}
                        <span
                          style={{
                            fontSize: "var(--bam-t-micro)",
                            color: "var(--bam-cream-40)",
                          }}
                        >
                          {truncateAddress(row.addressOrProgramId)}
                        </span>
                        {!row.isPublished ? (
                          <span
                            className="bam-badge bam-badge--pending"
                            style={{ marginLeft: "0.6rem" }}
                          >
                            Draft
                          </span>
                        ) : null}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {chainLabel(row.chain)}
                      </td>
                      <td className="bam-cell-num">{formatTvl(row.tvlUsd)}</td>
                      <td>
                        <StateMarker state={row.coverageState} />
                      </td>
                      <td className="bam-cell-num">{formatDrift(row.driftDays)}</td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {queueStatusLabel(row.queueStatus)}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {formatDate(row.queuedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length === 0 ? (
                <p className="bam-body" style={{ padding: "var(--bam-space-xl) 0" }}>
                  No targets. Seed the dev branch, or wait for the ingest worker
                  (step 5).
                </p>
              ) : null}
            </div>
          </Reveal>
        </section>
      </main>
    </>
  );
}
