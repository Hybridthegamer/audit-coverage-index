import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { getTarget } from "@/db/queries/workspace";
import {
  COVERAGE_LABEL,
  COVERAGE_MEANING,
  EMPTY,
  chainLabel,
  formatDate,
  formatDateTime,
  formatDrift,
  formatTvl,
  queueStatusLabel,
  shortCommit,
} from "@/lib/format";

/**
 * One target's private record, keyed by deployment id. It shows the researcher
 * everything behind the public verdict — the raw deployment facts, every audit
 * with the commit it reviewed and whether it covers THIS deployment, the
 * on-chain upgrade history, and the queue item's status + research log.
 *
 * This is a read view. Editing the queue, writing findings, and the disclosure
 * timeline are step 5; there is deliberately no mutation here beyond auth.
 *
 * force-dynamic: private, per-session, never cached.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Target",
};

/** A labelled key/value row in the editorial data-list style. */
function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="bam-data-row">
      <span className="bam-data-key">{label}</span>
      <span
        className="bam-data-val"
        style={accent ? { color: "var(--bam-red)" } : undefined}
      >
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="bam-title"
      style={{ marginBottom: "var(--bam-space-lg)", marginTop: "var(--bam-space-2xl)" }}
    >
      {children}
    </h2>
  );
}

export default async function TargetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deploymentId = Number(id);
  if (!Number.isInteger(deploymentId) || deploymentId <= 0) notFound();

  const target = await getTarget(deploymentId);
  if (!target) notFound();

  return (
    <>
      <WorkspaceNav page={target.protocolName.toUpperCase()} />

      <main className="bam-page">
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-xl)",
          }}
        >
          <div className="bam-mid">
            {/* ─── Header ────────────────────────────────────────────── */}
            <Reveal>
              <p className="bam-eyebrow">
                <Link
                  href="/workspace"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  ← THE QUEUE
                </Link>
              </p>
              <h1 className="bam-headline">{target.protocolName}</h1>
            </Reveal>

            <Reveal delay={80}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--bam-space-lg)",
                  flexWrap: "wrap",
                  marginTop: "var(--bam-space-md)",
                }}
              >
                <StateMarker state={target.coverageState} />
                <span
                  className="bam-badge bam-badge--pending"
                  style={{ borderColor: "var(--bam-cream-20)" }}
                >
                  Priority {target.priorityScore}
                </span>
                <span
                  className={`bam-badge ${
                    target.isPublished ? "bam-badge--confirmed" : "bam-badge--pending"
                  }`}
                >
                  {target.isPublished ? "Published" : "Draft"}
                </span>
              </div>
              <p
                className="bam-body"
                style={{ maxWidth: "54ch", marginTop: "var(--bam-space-md)" }}
              >
                {COVERAGE_MEANING[target.coverageState]}
              </p>
            </Reveal>

            {/* ─── Deployment ────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Deployment</SectionTitle>
              <div className="bam-data-list">
                <Row label="Label">{target.label ?? EMPTY}</Row>
                <Row label="Chain">{chainLabel(target.chain)}</Row>
                <Row label="Address / program">
                  {target.explorerUrl ? (
                    <a
                      href={target.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--bam-cream-80)",
                        borderBottom: "1px solid var(--bam-cream-20)",
                        textDecoration: "none",
                        wordBreak: "break-all",
                      }}
                    >
                      {target.addressOrProgramId}
                    </a>
                  ) : (
                    <span style={{ wordBreak: "break-all" }}>
                      {target.addressOrProgramId}
                    </span>
                  )}
                </Row>
                <Row label="TVL">{formatTvl(target.tvlUsd)}</Row>
                <Row label="Upgradeable">
                  {target.isUpgradeable ? "Yes" : "No"}
                </Row>
                <Row label="Upgrade authority">
                  {target.upgradeAuthority ?? EMPTY}
                </Row>
                <Row label="Deployed">{formatDate(target.deployedAt)}</Row>
                <Row label="Last upgraded">
                  {formatDate(target.lastUpgradedAt)}
                </Row>
                <Row label="Deployed commit">
                  {shortCommit(target.deployedCommit)}
                </Row>
                <Row label="Source verified">
                  {target.sourceVerified ? "Yes" : "No"}
                </Row>
              </div>
            </Reveal>

            {/* ─── Coverage ──────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Coverage</SectionTitle>
              <div className="bam-data-list">
                <Row
                  label="State"
                  accent={target.coverageState === "uncovered"}
                >
                  {COVERAGE_LABEL[target.coverageState]}
                </Row>
                <Row label="Drift (days)">
                  {formatDrift(target.driftDays)}
                </Row>
                <Row label="Priority score">{target.priorityScore}</Row>
                <Row label="Last checked">
                  {formatDate(target.lastCheckedAt)}
                </Row>
              </div>
            </Reveal>

            {/* ─── Audits ────────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Audits on record</SectionTitle>
              {target.audits.length === 0 ? (
                <p className="bam-body">
                  No audits recorded for this protocol.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--bam-space-md)",
                  }}
                >
                  {target.audits.map((audit) => (
                    <div
                      key={audit.id}
                      className={`bam-card${
                        audit.covered ? " bam-card--featured" : ""
                      }`}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: "var(--bam-space-md)",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--bam-font-serif)",
                            fontSize: "1.2rem",
                            color: "var(--bam-cream)",
                          }}
                        >
                          {audit.auditor}
                        </span>
                        <span
                          className={`bam-badge ${
                            audit.covered
                              ? "bam-badge--confirmed"
                              : "bam-badge--pending"
                          }`}
                        >
                          {audit.covered ? "Covers this" : "Other scope"}
                        </span>
                      </div>
                      <div
                        className="bam-data-list"
                        style={{ marginTop: "var(--bam-space-md)" }}
                      >
                        <Row label="Report date">
                          {formatDate(audit.reportDate)}
                        </Row>
                        <Row label="Reviewed commit">
                          {shortCommit(audit.reviewedCommit)}
                        </Row>
                        <Row label="Scope">{audit.scopeNote ?? EMPTY}</Row>
                        <Row label="Source">{audit.source}</Row>
                        <Row label="Verified by me">
                          {audit.verifiedByMe ? "Yes" : "No"}
                        </Row>
                        {audit.reportUrl ? (
                          <Row label="Report">
                            <a
                              href={audit.reportUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "var(--bam-cream-80)",
                                borderBottom: "1px solid var(--bam-cream-20)",
                                textDecoration: "none",
                              }}
                            >
                              Open ↗
                            </a>
                          </Row>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Reveal>

            {/* ─── Upgrade history ───────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Upgrade history</SectionTitle>
              {target.upgrades.length === 0 ? (
                <p className="bam-body">No on-chain upgrades recorded.</p>
              ) : (
                <div className="bam-data-list">
                  {target.upgrades.map((u) => (
                    <div className="bam-data-row" key={u.id}>
                      <span className="bam-data-key">
                        {formatDateTime(u.occurredAt)}
                      </span>
                      <span
                        className="bam-data-val"
                        style={{ wordBreak: "break-all", textAlign: "right" }}
                      >
                        {u.newImplementation ? (
                          <>→ {u.newImplementation}</>
                        ) : (
                          EMPTY
                        )}
                        {u.blockNumber !== null ? (
                          <span
                            style={{
                              display: "block",
                              fontSize: "var(--bam-t-micro)",
                              color: "var(--bam-cream-40)",
                            }}
                          >
                            block {u.blockNumber.toLocaleString("en-US")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Reveal>

            {/* ─── Queue item ────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Research queue</SectionTitle>
              {target.queueItem ? (
                <>
                  <div className="bam-data-list">
                    <Row label="Status">
                      {queueStatusLabel(target.queueItem.status)}
                    </Row>
                    <Row label="Manual priority">
                      {target.queueItem.priority ?? EMPTY}
                    </Row>
                    <Row label="Queued">
                      {formatDate(target.queueItem.queuedAt)}
                    </Row>
                    <Row label="Started">
                      {formatDate(target.queueItem.startedAt)}
                    </Row>
                    <Row label="Closed">
                      {formatDate(target.queueItem.closedAt)}
                    </Row>
                    {target.queueItem.clearReason ? (
                      <Row label="Clear reason">
                        {target.queueItem.clearReason}
                      </Row>
                    ) : null}
                  </div>
                  {target.queueItem.researchLog ? (
                    <div style={{ marginTop: "var(--bam-space-lg)" }}>
                      <p className="bam-data-key" style={{ marginBottom: "var(--bam-space-sm)" }}>
                        Research log
                      </p>
                      <pre
                        style={{
                          fontFamily: "var(--bam-font-mono)",
                          fontSize: "0.8rem",
                          color: "var(--bam-cream-60)",
                          lineHeight: 1.7,
                          whiteSpace: "pre-wrap",
                          background: "var(--bam-surface-2)",
                          border: "1px solid var(--bam-border)",
                          padding: "var(--bam-space-lg)",
                          overflowX: "auto",
                        }}
                      >
                        {target.queueItem.researchLog}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="bam-body">
                  Not queued. This target has no queue item yet — the ingest
                  worker (step 5) creates candidates, and queue transitions land
                  with it.
                </p>
              )}
            </Reveal>

            {/* ─── Findings placeholder (step 5) ─────────────────────── */}
            <Reveal>
              <SectionTitle>Findings</SectionTitle>
              <div className="bam-notice" style={{ borderColor: "var(--bam-border)", background: "var(--bam-cream-03)" }}>
                <p className="bam-notice-label" style={{ color: "var(--bam-cream-40)" }}>
                  Step 5
                </p>
                <p className="bam-notice-body">
                  The findings editor and disclosure timeline are built in the
                  next session. This view intentionally does not read the
                  findings or disclosure_events tables.
                </p>
              </div>

              {target.isPublished ? (
                <p
                  className="bam-body"
                  style={{ marginTop: "var(--bam-space-xl)" }}
                >
                  <Link
                    href={`/protocols/${target.protocolSlug}`}
                    style={{
                      color: "var(--bam-cream-80)",
                      borderBottom: "1px solid var(--bam-cream-20)",
                      textDecoration: "none",
                    }}
                  >
                    View the public page ↗
                  </Link>
                </p>
              ) : null}
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
