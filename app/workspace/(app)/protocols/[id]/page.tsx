import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import {
  discoverAuditsAction,
  pinDeploymentAction,
} from "@/app/workspace/mutations";
import { getProtocolDetail } from "@/db/queries/workspace";
import {
  auditStatusLabel,
  chainLabel,
  EMPTY,
  formatDate,
  formatTvl,
  plural,
  shortCommit,
} from "@/lib/format";
import { SUPPORTED_CHAINS } from "@/lib/sources/explorer";
import { CHAIN_LABEL } from "@/lib/format";

/**
 * A protocol's private record, keyed by protocol id — the step-7 page that
 * exists because step 6 left ~900 protocols with no deployment rows at all.
 *
 * `/workspace/targets/[id]` is keyed on a DEPLOYMENT and so cannot render a
 * protocol that has none. This page is where one gets its first contract
 * pinned, which is the act that graduates it out of the queue's "sourced, not
 * yet pinned" table and into the ranked queue with a coverage state to earn.
 *
 * Two things it does and the target page cannot:
 *   · pin a contract (the form below)
 *   · walk the protocol's GitHub for audit reports, which is protocol-level
 *     work — reports belong to a project, not to one address
 *
 * force-dynamic: private, per-session, never cached.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Protocol",
};

/** Chains an explorer can resolve, listed first so the common case is on top. */
const CHAIN_OPTIONS = [
  ...SUPPORTED_CHAINS,
  ...Object.keys(CHAIN_LABEL).filter((c) => !SUPPORTED_CHAINS.includes(c)),
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bam-data-row">
      <span className="bam-data-key">{label}</span>
      <span className="bam-data-val">{children}</span>
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

export default async function ProtocolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const protocolId = Number(id);
  if (!Number.isInteger(protocolId) || protocolId <= 0) notFound();

  const protocol = await getProtocolDetail(protocolId);
  if (!protocol) notFound();

  const pinned = protocol.deployments.length;

  return (
    <>
      <WorkspaceNav page={protocol.name.toUpperCase()} />

      <main className="bam-page">
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-3xl)",
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
              <h1 className="bam-headline">{protocol.name}</h1>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--bam-space-lg)",
                  flexWrap: "wrap",
                  marginTop: "var(--bam-space-md)",
                }}
              >
                {protocol.auditStatus === "unaudited" ? (
                  <span className="bam-badge bam-badge--confirmed">
                    {auditStatusLabel(protocol.auditStatus)}
                  </span>
                ) : (
                  <span className="bam-badge bam-badge--pending">
                    {auditStatusLabel(protocol.auditStatus)}
                  </span>
                )}
                <span
                  className="bam-badge bam-badge--pending"
                  style={{ borderColor: "var(--bam-cream-20)" }}
                >
                  Priority {protocol.priorityScore}
                </span>
                <span
                  className={`bam-badge ${
                    protocol.isPublished ? "bam-badge--confirmed" : "bam-badge--pending"
                  }`}
                >
                  {protocol.isPublished ? "Published" : "Draft"}
                </span>
              </div>

              <p
                className="bam-body"
                style={{ maxWidth: "56ch", marginTop: "var(--bam-space-md)" }}
              >
                {pinned === 0 ? (
                  <>
                    No contracts pinned yet, so this protocol carries no coverage
                    state — the DefiLlama feed that sourced it lists money and
                    audit reports, never deployed code. Pin an address below and
                    it joins the ranked queue.
                  </>
                ) : (
                  <>
                    {plural(pinned, "contract")} pinned. Coverage is computed per
                    contract; open one to record its deployed commit and link the
                    audits that cover it.
                  </>
                )}
              </p>
            </Reveal>

            {/* ─── Protocol facts ────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Protocol</SectionTitle>
              <div className="bam-data-list">
                <Row label="Slug">{protocol.slug}</Row>
                <Row label="TVL">{formatTvl(protocol.tvlUsd)}</Row>
                <Row label="Website">
                  {protocol.website ? (
                    <a
                      href={protocol.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      style={{
                        color: "var(--bam-cream-80)",
                        borderBottom: "1px solid var(--bam-cream-20)",
                        textDecoration: "none",
                        wordBreak: "break-all",
                      }}
                    >
                      {protocol.website}
                    </a>
                  ) : (
                    EMPTY
                  )}
                </Row>
                <Row label="GitHub">
                  {protocol.githubRepo ? (
                    <a
                      href={protocol.githubRepo}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      style={{
                        color: "var(--bam-cream-80)",
                        borderBottom: "1px solid var(--bam-cream-20)",
                        textDecoration: "none",
                        wordBreak: "break-all",
                      }}
                    >
                      {protocol.githubRepo}
                    </a>
                  ) : (
                    EMPTY
                  )}
                </Row>
                <Row label="Twitter">{protocol.twitter ?? EMPTY}</Row>
                <Row label="Security contact">
                  {protocol.securityContact ?? EMPTY}
                </Row>
                <Row label="Bounty">
                  {protocol.hasBounty ? protocol.bountyPlatform : "None on record"}
                </Row>
              </div>
            </Reveal>

            {/* ─── Pin a contract ────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Pin a contract</SectionTitle>
              <p
                className="bam-body"
                style={{ maxWidth: "56ch", marginBottom: "var(--bam-space-lg)" }}
              >
                One address per deployment. EVM addresses are stored lowercase and
                de-duplicated, so pinning the same contract twice is a no-op.
                Chains with block-explorer support resolve automatically;
                everything else is recorded by hand.
              </p>

              <form action={pinDeploymentAction}>
                <input type="hidden" name="protocolId" value={protocol.protocolId} />
                <div className="bam-form-grid">
                  <div className="bam-field">
                    <label className="bam-label" htmlFor="chain">
                      Chain
                    </label>
                    <select
                      id="chain"
                      name="chain"
                      className="bam-input"
                      defaultValue="ethereum"
                    >
                      {CHAIN_OPTIONS.map((chain) => (
                        <option key={chain} value={chain}>
                          {chainLabel(chain)}
                          {SUPPORTED_CHAINS.includes(chain) ? "" : " (manual)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bam-field">
                    <label className="bam-label" htmlFor="label">
                      Label
                    </label>
                    <input
                      id="label"
                      name="label"
                      className="bam-input"
                      placeholder="e.g. Pool (main)"
                    />
                  </div>
                </div>
                <div className="bam-field">
                  <label className="bam-label" htmlFor="addressOrProgramId">
                    Address / program id
                  </label>
                  <input
                    id="addressOrProgramId"
                    name="addressOrProgramId"
                    className="bam-input"
                    required
                    placeholder="0x…"
                  />
                </div>
                <button type="submit" className="bam-btn-primary">
                  Pin contract
                </button>
              </form>
            </Reveal>

            {/* ─── Pinned contracts ──────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Pinned contracts</SectionTitle>
              {pinned === 0 ? (
                <p className="bam-body">Nothing pinned yet.</p>
              ) : (
                <div className="bam-table-scroll">
                  <table className="bam-table">
                    <thead>
                      <tr>
                        <th scope="col">Contract</th>
                        <th scope="col">Chain</th>
                        <th scope="col">Coverage</th>
                        <th scope="col">Deployed commit</th>
                        <th scope="col">Deployed</th>
                        <th scope="col" style={{ textAlign: "right" }}>
                          Upgrades
                        </th>
                        <th scope="col">Resolved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {protocol.deployments.map((d) => (
                        <tr key={d.deploymentId}>
                          <td>
                            <Link
                              href={`/workspace/targets/${d.deploymentId}`}
                              className="bam-cell-name"
                              style={{ textDecoration: "none" }}
                            >
                              {d.label ?? "Unlabelled"}
                            </Link>{" "}
                            <span
                              style={{
                                fontSize: "var(--bam-t-micro)",
                                color: "var(--bam-cream-40)",
                                wordBreak: "break-all",
                              }}
                            >
                              {d.addressOrProgramId}
                            </span>
                          </td>
                          <td style={{ color: "var(--bam-cream-60)" }}>
                            {chainLabel(d.chain)}
                          </td>
                          <td>
                            <StateMarker state={d.coverageState} />
                          </td>
                          <td style={{ color: "var(--bam-cream-60)" }}>
                            {shortCommit(d.deployedCommit)}
                          </td>
                          <td style={{ color: "var(--bam-cream-60)" }}>
                            {formatDate(d.deployedAt)}
                          </td>
                          <td className="bam-cell-num">{d.upgradeCount}</td>
                          <td style={{ color: "var(--bam-cream-60)" }}>
                            {formatDate(d.lastCheckedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Reveal>

            {/* ─── Audits on record ──────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Audits on record</SectionTitle>
              <p
                className="bam-body"
                style={{ maxWidth: "56ch", marginBottom: "var(--bam-space-lg)" }}
              >
                Discovery walks the protocol&rsquo;s repo for an{" "}
                <code>audits/</code> folder and records what it finds: the
                auditor and, where the filename states one, the report date. It
                never records a reviewed commit — a report lands days or weeks
                after the review it describes, so the candidate sha goes in the
                scope note and you promote it from the target page.
              </p>

              <form
                action={discoverAuditsAction}
                style={{ marginBottom: "var(--bam-space-lg)" }}
              >
                <input type="hidden" name="protocolId" value={protocol.protocolId} />
                <button
                  type="submit"
                  className="bam-btn-sm"
                  disabled={protocol.githubRepo === null}
                >
                  {protocol.githubRepo === null
                    ? "Discover audits (no GitHub on record)"
                    : "Discover audits on GitHub"}
                </button>
              </form>

              {protocol.audits.length === 0 ? (
                <p className="bam-body">No audits recorded for this protocol.</p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--bam-space-md)",
                  }}
                >
                  {protocol.audits.map((audit) => (
                    <div key={audit.id} className="bam-card">
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
                            audit.verifiedByMe
                              ? "bam-badge--confirmed"
                              : "bam-badge--pending"
                          }`}
                        >
                          {audit.verifiedByMe ? "Verified" : audit.source}
                        </span>
                      </div>
                      <div
                        className="bam-data-list"
                        style={{ marginTop: "var(--bam-space-md)" }}
                      >
                        <Row label="Report date">{formatDate(audit.reportDate)}</Row>
                        <Row label="Reviewed commit">
                          {shortCommit(audit.reviewedCommit)}
                        </Row>
                        {audit.reportUrl ? (
                          <Row label="Report">
                            <a
                              href={audit.reportUrl}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
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
                        <Row label="Scope">{audit.scopeNote ?? EMPTY}</Row>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
