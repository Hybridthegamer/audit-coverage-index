import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import {
  recordDeployedCommitAction,
  recordReviewedCommitAction,
  resolveDeploymentAction,
  saveResearchLog,
  setAuditCoverageAction,
  setPublished,
  transitionQueue,
} from "@/app/workspace/mutations";
import { getFindingsForDeployment, getTarget } from "@/db/queries/workspace";
import {
  COVERAGE_LABEL,
  COVERAGE_MEANING,
  EMPTY,
  chainLabel,
  findingStatusLabel,
  formatDate,
  formatDateTime,
  formatDrift,
  formatTvl,
  queueStatusLabel,
  shortCommit,
} from "@/lib/format";
import { isSupportedChain, SUPPORTED_CHAINS } from "@/lib/sources/explorer";

const QUEUE_TRANSITIONS: { status: string; label: string }[] = [
  { status: "queued", label: "Queue" },
  { status: "in_review", label: "Start review" },
  { status: "finding_found", label: "Finding found" },
  { status: "dropped", label: "Drop" },
];

/**
 * One target's private record, keyed by deployment id. It shows the researcher
 * everything behind the public verdict — the raw deployment facts, every audit
 * with the commit it reviewed and whether it covers THIS deployment, the
 * on-chain upgrade history, and the queue item's status + research log.
 *
 * Step 5 made it writable (queue transitions, research log, findings). Step 7
 * added the three things that turn `unknown` into a real verdict: resolve the
 * contract against its block explorer, record the DEPLOYED commit, and record
 * each audit's REVIEWED commit plus whether it covers this deployment.
 *
 * Those last two are forms rather than an automated sweep on purpose. No
 * explorer knows a git commit and no filename is a review scope, so both are
 * the researcher's assertion — and the audit/deployment link is the single
 * claim the whole public coverage verdict rests on.
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

  const [target, findings] = await Promise.all([
    getTarget(deploymentId),
    getFindingsForDeployment(deploymentId),
  ]);
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

              {/* Publish toggle — flips public visibility and revalidates the
                  public ISR pages immediately (see setPublished). */}
              <form action={setPublished} style={{ marginTop: "var(--bam-space-md)" }}>
                <input type="hidden" name="deploymentId" value={target.deploymentId} />
                <input
                  type="hidden"
                  name="isPublished"
                  value={target.isPublished ? "false" : "true"}
                />
                <button type="submit" className="bam-btn-sm">
                  {target.isPublished ? "Unpublish protocol" : "Publish protocol"}
                </button>
              </form>
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

              {/* Resolve against the block explorer: creation date, proxy admin,
                  every Upgraded(address) log. It cannot resolve the deployed
                  COMMIT — an explorer has bytecode, never a commit — which is
                  what the form below it is for. */}
              <div style={{ marginTop: "var(--bam-space-lg)" }}>
                {isSupportedChain(target.chain) ? (
                  <form action={resolveDeploymentAction}>
                    <input
                      type="hidden"
                      name="deploymentId"
                      value={target.deploymentId}
                    />
                    <button type="submit" className="bam-btn-sm">
                      {target.lastCheckedAt === null
                        ? "Resolve on-chain"
                        : "Re-resolve on-chain"}
                    </button>
                  </form>
                ) : (
                  <p className="bam-body">
                    {chainLabel(target.chain)} has no block-explorer support, so
                    this deployment&rsquo;s facts are recorded by hand. Automatic
                    resolution covers {SUPPORTED_CHAINS.length} EVM chains.
                  </p>
                )}
              </div>

              {/* The DEPLOYED commit — half of what computeDrift needs, and the
                  half nothing automated can supply. Submitting it empty clears
                  the claim and returns the target to `unknown`. */}
              <form
                action={recordDeployedCommitAction}
                style={{ marginTop: "var(--bam-space-lg)" }}
              >
                <input type="hidden" name="deploymentId" value={target.deploymentId} />
                <div className="bam-field">
                  <label className="bam-label" htmlFor="deployedCommit">
                    Deployed commit — your assertion, matched from the verified
                    source. Empty clears it.
                  </label>
                  <input
                    id="deployedCommit"
                    name="deployedCommit"
                    className="bam-input"
                    defaultValue={target.deployedCommit ?? ""}
                    placeholder="abc1234…"
                  />
                </div>
                <button type="submit" className="bam-btn-sm">
                  Record deployed commit
                </button>
              </form>
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

                      {/* The REVIEWED commit. Discovery leaves a candidate sha
                          in the scope note above; this is where it stops being
                          a note. Recording it also marks the audit verified,
                          because filling it in IS the verification — somebody
                          opened the report and read its scope section. */}
                      <form
                        action={recordReviewedCommitAction}
                        style={{ marginTop: "var(--bam-space-md)" }}
                      >
                        <input type="hidden" name="auditId" value={audit.id} />
                        <input
                          type="hidden"
                          name="deploymentId"
                          value={target.deploymentId}
                        />
                        <div className="bam-form-grid">
                          <div className="bam-field">
                            <label
                              className="bam-label"
                              htmlFor={"reviewedCommit-" + audit.id}
                            >
                              Reviewed commit
                            </label>
                            <input
                              id={"reviewedCommit-" + audit.id}
                              name="reviewedCommit"
                              className="bam-input"
                              defaultValue={audit.reviewedCommit ?? ""}
                              placeholder="def5678…"
                            />
                          </div>
                          <div className="bam-field">
                            <label
                              className="bam-label"
                              htmlFor={"reportDate-" + audit.id}
                            >
                              Report date (off the cover page)
                            </label>
                            <input
                              id={"reportDate-" + audit.id}
                              name="reportDate"
                              type="date"
                              className="bam-input"
                              defaultValue={
                                audit.reportDate
                                  ? audit.reportDate.toISOString().slice(0, 10)
                                  : ""
                              }
                            />
                          </div>
                        </div>
                        <button type="submit" className="bam-btn-sm">
                          Record reviewed commit
                        </button>
                      </form>

                      {/* The ancestry assertion. recomputeDrift trusts this link
                          as recorded proof that the reviewed commit is an
                          ancestor of what is deployed here — the single claim
                          the public verdict rests on, which is why nothing
                          automated ever creates one. */}
                      <form
                        action={setAuditCoverageAction}
                        style={{ marginTop: "var(--bam-space-md)" }}
                      >
                        <input type="hidden" name="auditId" value={audit.id} />
                        <input
                          type="hidden"
                          name="deploymentId"
                          value={target.deploymentId}
                        />
                        <input
                          type="hidden"
                          name="covered"
                          value={audit.covered ? "false" : "true"}
                        />
                        <button type="submit" className="bam-btn-sm">
                          {audit.covered
                            ? "Unlink from this deployment"
                            : "This audit covers this deployment"}
                        </button>
                      </form>
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

              <div className="bam-data-list">
                <Row label="Status">
                  {queueStatusLabel(target.queueItem?.status ?? null)}
                </Row>
                {target.queueItem ? (
                  <>
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
                  </>
                ) : null}
              </div>

              {/* Status transitions */}
              <div
                style={{
                  display: "flex",
                  gap: "var(--bam-space-sm)",
                  flexWrap: "wrap",
                  marginTop: "var(--bam-space-lg)",
                }}
              >
                {QUEUE_TRANSITIONS.map((t) => (
                  <form action={transitionQueue} key={t.status}>
                    <input type="hidden" name="deploymentId" value={target.deploymentId} />
                    <input type="hidden" name="status" value={t.status} />
                    <button
                      type="submit"
                      className="bam-btn-sm"
                      disabled={target.queueItem?.status === t.status}
                    >
                      {t.label}
                    </button>
                  </form>
                ))}
              </div>

              {/* Clear requires a reason (DB check constraint + this form). */}
              <form
                action={transitionQueue}
                style={{ marginTop: "var(--bam-space-lg)" }}
              >
                <input type="hidden" name="deploymentId" value={target.deploymentId} />
                <input type="hidden" name="status" value="cleared" />
                <div className="bam-field">
                  <label className="bam-label" htmlFor="clearReason">
                    Clear reason (required to clear)
                  </label>
                  <input
                    id="clearReason"
                    name="clearReason"
                    className="bam-input"
                    placeholder="Why this target is cleared without a finding"
                  />
                </div>
                <button type="submit" className="bam-btn-sm">
                  Clear target
                </button>
              </form>

              {/* Research log + manual priority editor */}
              <form
                action={saveResearchLog}
                style={{ marginTop: "var(--bam-space-xl)" }}
              >
                <input type="hidden" name="deploymentId" value={target.deploymentId} />
                <div className="bam-field">
                  <label className="bam-label" htmlFor="priority">
                    Manual priority (overrides the computed score in the queue)
                  </label>
                  <input
                    id="priority"
                    name="priority"
                    type="number"
                    className="bam-input"
                    defaultValue={target.queueItem?.priority ?? ""}
                    placeholder="e.g. 1"
                  />
                </div>
                <div className="bam-field">
                  <label className="bam-label" htmlFor="researchLog">
                    Research log
                  </label>
                  <textarea
                    id="researchLog"
                    name="researchLog"
                    className="bam-input"
                    style={{ minHeight: "9rem" }}
                    defaultValue={target.queueItem?.researchLog ?? ""}
                    placeholder="Notes, diffs, links…"
                  />
                </div>
                <button type="submit" className="bam-btn-primary">
                  Save log
                </button>
              </form>
            </Reveal>

            {/* ─── Findings ──────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Findings</SectionTitle>

              {findings.length === 0 ? (
                <p className="bam-body">No findings filed against this target yet.</p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--bam-space-sm)",
                  }}
                >
                  {findings.map((f) => (
                    <Link
                      key={f.id}
                      href={`/workspace/findings/${f.id}`}
                      className="bam-card"
                      style={{
                        textDecoration: "none",
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
                          fontSize: "1.1rem",
                          color: "var(--bam-cream)",
                        }}
                      >
                        {f.title}
                      </span>
                      <span
                        style={{
                          display: "inline-flex",
                          gap: "var(--bam-space-sm)",
                          alignItems: "baseline",
                          fontSize: "var(--bam-t-micro)",
                          color: "var(--bam-cream-40)",
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                        }}
                      >
                        {f.severity ? <span>{f.severity}</span> : null}
                        <span>{findingStatusLabel(f.status)}</span>
                        {f.inPostAuditCode ? (
                          <span style={{ color: "var(--bam-red)" }}>post-audit</span>
                        ) : null}
                        <span>
                          {f.disclosureCount}{" "}
                          {f.disclosureCount === 1 ? "event" : "events"}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {/* Step 7: the submission generator hangs off each finding — the
                  template\'s three artefacts, rendered from what is recorded. */}
              {findings.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: "var(--bam-space-sm)",
                    flexWrap: "wrap",
                    marginTop: "var(--bam-space-md)",
                  }}
                >
                  {findings.map((f) => (
                    <Link
                      key={f.id}
                      href={"/workspace/findings/" + f.id + "/submission"}
                      className="bam-btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      Submission · {f.title.slice(0, 28)}
                      {f.title.length > 28 ? "…" : ""}
                    </Link>
                  ))}
                </div>
              ) : null}

              <div style={{ marginTop: "var(--bam-space-lg)" }}>
                <Link
                  href={`/workspace/targets/${target.deploymentId}/findings/new`}
                  className="bam-btn-ghost"
                >
                  New finding
                </Link>
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
