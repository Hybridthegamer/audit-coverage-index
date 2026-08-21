import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { SiteNav } from "@/components/SiteNav";
import { StateMarker } from "@/components/StateMarker";
import { getCoverageSummary, getIndexRows } from "@/db/queries/public";
import type { CoverageState } from "@/lib/drift";
import {
  COVERAGE_MEANING,
  chainLabel,
  formatDate,
  formatDrift,
  formatTvl,
  plural,
  truncateAddress,
} from "@/lib/format";

/**
 * The coverage index — the dense surface, and the reason the design system has
 * two. Every published deployment, one row each, ordered most-severe first.
 *
 * The grid is monochrome cream-at-opacity so that the single reserved red
 * (uncovered) is the only thing the eye jumps to down a long column. That is
 * also why the whole table sits inside ONE <Reveal>: staggering 200+ rows would
 * be motion sickness, not editorial.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "The index",
  description:
    "Every tracked DeFi deployment, with the audit that covers it and the days of code shipped since.",
  alternates: { canonical: "/index" },
};

const LEGEND: CoverageState[] = ["uncovered", "drifted", "current", "unknown"];

export default async function IndexPage() {
  const [rows, summary] = await Promise.all([
    getIndexRows(),
    getCoverageSummary(),
  ]);

  return (
    <>
      <SiteNav page="THE INDEX" />

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
              {plural(summary.total, "DEPLOYMENT")} ·{" "}
              {plural(summary.protocolCount, "PROTOCOL")} · UPDATED HOURLY
            </p>
            <h1 className="bam-headline">The index.</h1>
            <p
              className="bam-body"
              style={{ maxWidth: "56ch", marginTop: "var(--bam-space-lg)" }}
            >
              Sorted by severity, then by how long the code has been running
              unreviewed. Drift is measured in days between the covering
              audit&apos;s report date and the most recent on-chain upgrade.
            </p>
          </Reveal>

          {/* Legend — the four states, before the reader meets them in situ. */}
          <Reveal delay={100}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--bam-space-lg)",
                marginTop: "var(--bam-space-xl)",
                paddingTop: "var(--bam-space-md)",
                borderTop: "1px solid var(--bam-border)",
              }}
            >
              {LEGEND.map((state) => (
                <span
                  key={state}
                  title={COVERAGE_MEANING[state]}
                  style={{ display: "inline-flex", gap: "0.5rem" }}
                >
                  <StateMarker state={state} />
                  <span
                    style={{
                      fontSize: "var(--bam-t-micro)",
                      color: "var(--bam-cream-20)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {summary[state]}
                  </span>
                </span>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ─── The table ───────────────────────────────────────────────── */}
        <section className="bam-pad-x" style={{ paddingBottom: "var(--bam-space-3xl)" }}>
          <Reveal>
            <div className="bam-table-scroll">
              <table className="bam-table">
                <caption className="bam-eyebrow" style={{ textAlign: "left", marginBottom: "var(--bam-space-sm)" }}>
                  AUDIT COVERAGE BY DEPLOYMENT
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Protocol</th>
                    <th scope="col">Chain</th>
                    <th scope="col">Contract</th>
                    <th scope="col" style={{ textAlign: "right" }}>TVL</th>
                    <th scope="col">Coverage</th>
                    <th scope="col" style={{ textAlign: "right" }}>Drift (days)</th>
                    <th scope="col">Last upgrade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.deploymentId}>
                      <td>
                        <Link
                          href={`/protocols/${row.protocolSlug}`}
                          className="bam-cell-name"
                          style={{ textDecoration: "none" }}
                        >
                          {row.protocolName}
                        </Link>
                        {row.label ? (
                          <span
                            style={{
                              marginLeft: "0.6rem",
                              fontSize: "var(--bam-t-micro)",
                              color: "var(--bam-cream-40)",
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                            }}
                          >
                            {row.label}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {chainLabel(row.chain)}
                      </td>
                      <td>
                        {row.explorerUrl ? (
                          <a
                            href={row.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "var(--bam-cream-60)",
                              textDecoration: "none",
                              borderBottom: "1px solid var(--bam-cream-20)",
                            }}
                          >
                            {truncateAddress(row.addressOrProgramId)}
                          </a>
                        ) : (
                          <span style={{ color: "var(--bam-cream-60)" }}>
                            {truncateAddress(row.addressOrProgramId)}
                          </span>
                        )}
                      </td>
                      <td className="bam-cell-num">{formatTvl(row.tvlUsd)}</td>
                      <td>
                        <StateMarker state={row.coverageState} />
                      </td>
                      <td className="bam-cell-num">
                        {formatDrift(row.driftDays)}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {formatDate(row.lastUpgradedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length === 0 ? (
                <p
                  className="bam-body"
                  style={{ padding: "var(--bam-space-xl) 0" }}
                >
                  No published deployments yet.
                </p>
              ) : null}
            </div>
          </Reveal>
        </section>
      </main>
    </>
  );
}
