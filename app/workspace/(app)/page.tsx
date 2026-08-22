import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import {
  discoverAuditsSweepAction,
  resolveOnChainSweepAction,
  runIngestAction,
  syncDefiLlamaAction,
} from "@/app/workspace/mutations";
import {
  getQueue,
  getSourcedProtocols,
  summarizeQueue,
} from "@/db/queries/workspace";
import {
  auditStatusLabel,
  chainLabel,
  formatDate,
  formatDrift,
  formatTvl,
  plural,
  queueStatusLabel,
  truncateAddress,
} from "@/lib/format";
import { IN_APP_SYNC_LIMIT } from "@/lib/sources/defillama.config";
import { IN_APP_RESOLVE_LIMIT } from "@/lib/sources/explorer.config";
import { IN_APP_DISCOVER_LIMIT } from "@/lib/sources/github.config";

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

/** How many unpinned protocols the second table renders before truncating. */
const SOURCED_LIMIT = 100;

export default async function QueuePage() {
  const [rows, sourced] = await Promise.all([getQueue(), getSourcedProtocols(SOURCED_LIMIT)]);
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
              {plural(counts.unpublished, "UNPUBLISHED")} ·{" "}
              {plural(sourced.total, "UNPINNED PROTOCOL")}
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

            <div
              style={{
                display: "flex",
                gap: "var(--bam-space-sm)",
                flexWrap: "wrap",
                marginTop: "var(--bam-space-lg)",
              }}
            >
              {/* Ingest: recompute drift for every deployment and top up the
                  candidate queue, then revalidate the public pages. */}
              <form action={runIngestAction}>
                <button type="submit" className="bam-btn-sm">
                  Run ingest
                </button>
              </form>

              {/* Sourcing: the capped in-app refresh. `npm run db:source` is the
                  full run — see lib/sources/defillama.config.ts. */}
              <form action={syncDefiLlamaAction}>
                <button type="submit" className="bam-btn-sm">
                  Sync DefiLlama · top {IN_APP_SYNC_LIMIT}
                </button>
              </form>

              {/* Step 7. Both are capped for the same reason the sync above is:
                  `npm run db:onchain` and `npm run db:audits` are the primary
                  run paths, and these buttons exist because only they can call
                  revalidatePath. */}
              <form action={resolveOnChainSweepAction}>
                <button type="submit" className="bam-btn-sm">
                  Resolve on-chain · {IN_APP_RESOLVE_LIMIT}
                </button>
              </form>

              <form action={discoverAuditsSweepAction}>
                <button type="submit" className="bam-btn-sm">
                  Discover audits · {IN_APP_DISCOVER_LIMIT}
                </button>
              </form>
            </div>
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
                    <th scope="col">Audit</th>
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
                        {row.auditStatus === "unaudited" ? (
                          <span className="bam-badge bam-badge--confirmed">
                            {auditStatusLabel(row.auditStatus)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--bam-cream-40)" }}>
                            {auditStatusLabel(row.auditStatus)}
                          </span>
                        )}
                      </td>
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
                  No targets. Seed the dev branch, or run{" "}
                  <code>npm run db:source</code> to pull the curated DefiLlama set.
                </p>
              ) : null}
            </div>
          </Reveal>
        </section>

        {/* Sourced protocols with no deployment rows yet. DefiLlama gives no
            contract addresses, so these cannot appear in the ranked queue above
            — but an unaudited protocol holding real money is a target before
            anybody has pinned its contracts. Step 7 graduates them. */}
        {sourced.total > 0 ? (
          <section
            className="bam-pad-x"
            style={{ paddingBottom: "var(--bam-space-3xl)" }}
          >
            <Reveal>
              <p className="bam-eyebrow">
                {plural(sourced.total, "PROTOCOL")} ·{" "}
                {sourced.unaudited} WITH NO AUDIT ON RECORD
              </p>
              <h2 className="bam-title">Sourced, not yet pinned.</h2>
              <p
                className="bam-body"
                style={{ maxWidth: "58ch", marginTop: "var(--bam-space-md)" }}
              >
                Protocols the DefiLlama sync curated but for which no contract
                addresses have been recorded, so they carry no coverage state
                yet — the feed lists TVL and audit reports, never deployed code.
                Ranked by audit presence and money at risk. Open one to pin its
                contracts and walk its repo for audit reports; one pinned
                address is enough to graduate it into the queue above.
              </p>

              <div
                className="bam-table-scroll"
                style={{ marginTop: "var(--bam-space-lg)" }}
              >
                <table className="bam-table">
                  <caption
                    className="bam-eyebrow"
                    style={{ textAlign: "left", marginBottom: "var(--bam-space-sm)" }}
                  >
                    UNPINNED PROTOCOLS · RANKED
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Priority
                      </th>
                      <th scope="col">Protocol</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        TVL
                      </th>
                      <th scope="col">Audit</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Reports
                      </th>
                      <th scope="col">Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourced.rows.map((p) => (
                      <tr key={p.protocolId}>
                        <td className="bam-cell-num">{p.priorityScore}</td>
                        <td>
                          <Link
                            href={"/workspace/protocols/" + p.protocolId}
                            className="bam-cell-name"
                            style={{ textDecoration: "none" }}
                          >
                            {p.name}
                          </Link>{" "}
                          <span
                            style={{
                              fontSize: "var(--bam-t-micro)",
                              color: "var(--bam-cream-40)",
                            }}
                          >
                            {p.slug}
                          </span>
                        </td>
                        <td className="bam-cell-num">{formatTvl(p.tvlUsd)}</td>
                        <td>
                          {p.auditStatus === "unaudited" ? (
                            <span className="bam-badge bam-badge--confirmed">
                              {auditStatusLabel(p.auditStatus)}
                            </span>
                          ) : (
                            <span style={{ color: "var(--bam-cream-40)" }}>
                              {auditStatusLabel(p.auditStatus)}
                            </span>
                          )}
                        </td>
                        <td className="bam-cell-num">{p.auditCount}</td>
                        <td style={{ color: "var(--bam-cream-60)" }}>
                          {p.website ? (
                            <a href={p.website} rel="noopener noreferrer nofollow">
                              site
                            </a>
                          ) : null}
                          {p.website && p.githubRepo ? " · " : null}
                          {p.githubRepo ? (
                            <a href={p.githubRepo} rel="noopener noreferrer nofollow">
                              github
                            </a>
                          ) : null}
                          {(p.website || p.githubRepo) && p.twitter ? " · " : null}
                          {p.twitter ? (
                            <a
                              href={`https://x.com/${p.twitter}`}
                              rel="noopener noreferrer nofollow"
                            >
                              x
                            </a>
                          ) : null}
                          {!p.website && !p.githubRepo && !p.twitter ? "—" : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {sourced.total > sourced.rows.length ? (
                  <p
                    className="bam-eyebrow"
                    style={{ paddingTop: "var(--bam-space-md)" }}
                  >
                    Showing the top {sourced.rows.length} of{" "}
                    {plural(sourced.total, "protocol")}.
                  </p>
                ) : null}
              </div>
            </Reveal>
          </section>
        ) : null}
      </main>
    </>
  );
}
