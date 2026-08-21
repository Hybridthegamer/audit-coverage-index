import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Reveal } from "@/components/Reveal";
import { SiteNav } from "@/components/SiteNav";
import { StateMarker } from "@/components/StateMarker";
import { getProtocolBySlug, getPublishedSlugs } from "@/db/queries/public";
import {
  COVERAGE_MEANING,
  EMPTY,
  chainLabel,
  formatDate,
  formatDrift,
  formatTvl,
  plural,
  shortCommit,
  truncateAddress,
} from "@/lib/format";

/**
 * One protocol's public record: every tracked deployment with its coverage
 * state, and every audit we hold with the commit it reviewed. The point of the
 * page is to let a reader check our arithmetic — the commits and dates that
 * produced each state are all on the page, not just the verdict.
 *
 * Rendering: prerendered at build for every published slug, then ISR-refreshed
 * hourly. `dynamicParams` stays on so a protocol published between builds is
 * served on first request rather than 404ing until the next deploy.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const protocol = await getProtocolBySlug(slug);
  if (!protocol) return { title: "Not found" };

  const uncovered = protocol.deployments.filter(
    (d) => d.coverageState === "uncovered",
  ).length;
  const description = uncovered
    ? `${uncovered} of ${protocol.deployments.length} tracked ${protocol.name} deployments run code that is downstream of every audit.`
    : `Audit coverage for ${protocol.deployments.length} tracked ${protocol.name} deployments.`;

  return {
    title: protocol.name,
    description,
    alternates: { canonical: `/protocols/${protocol.slug}` },
  };
}

export default async function ProtocolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const protocol = await getProtocolBySlug(slug);
  if (!protocol) notFound();

  const uncovered = protocol.deployments.filter(
    (d) => d.coverageState === "uncovered",
  ).length;

  return (
    <>
      <SiteNav page={protocol.name.toUpperCase()} />

      <main className="bam-page">
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-xl)",
          }}
        >
          <div className="bam-wide">
            <Reveal>
              <p className="bam-eyebrow">
                <Link href="/index" style={{ color: "inherit", textDecoration: "none" }}>
                  ← THE INDEX
                </Link>
              </p>
              <h1 className="bam-headline">{protocol.name}</h1>
            </Reveal>

            <Reveal delay={80}>
              <p
                className="bam-body"
                style={{ maxWidth: "52ch", marginTop: "var(--bam-space-lg)" }}
              >
                {plural(protocol.deployments.length, "tracked deployment")} ·{" "}
                {plural(protocol.audits.length, "audit")} on record
                {uncovered > 0
                  ? ` — ${uncovered === 1 ? "one runs" : `${uncovered} run`} code no audit covers.`
                  : "."}
              </p>

              {/* External links */}
              <div
                style={{
                  display: "flex",
                  gap: "var(--bam-space-lg)",
                  flexWrap: "wrap",
                  marginTop: "var(--bam-space-lg)",
                }}
              >
                {protocol.website ? (
                  <ExternalLink href={protocol.website} label="WEBSITE" />
                ) : null}
                {protocol.githubRepo ? (
                  <ExternalLink href={protocol.githubRepo} label="SOURCE" />
                ) : null}
                {protocol.hasBounty && protocol.bountyUrl ? (
                  <ExternalLink
                    href={protocol.bountyUrl}
                    label={`BOUNTY · ${protocol.bountyPlatform.toUpperCase()}`}
                  />
                ) : null}
              </div>
            </Reveal>

            {protocol.publicNote ? (
              <Reveal delay={140}>
                <div
                  className="bam-notice"
                  style={{ marginTop: "var(--bam-space-xl)" }}
                >
                  <p className="bam-notice-label">Note</p>
                  <p className="bam-notice-body">{protocol.publicNote}</p>
                </div>
              </Reveal>
            ) : null}
          </div>
        </section>

        {/* ─── Deployments ─────────────────────────────────────────────── */}
        <section
          className="bam-pad-x"
          style={{ paddingBottom: "var(--bam-space-2xl)" }}
        >
          <div className="bam-wide">
            <Reveal>
              <p className="bam-eyebrow">DEPLOYMENTS</p>
            </Reveal>

            {protocol.deployments.map((d, i) => (
              <Reveal key={d.deploymentId} delay={i * 60}>
                <article
                  className={
                    d.coverageState === "uncovered"
                      ? "bam-card bam-card--featured"
                      : "bam-card"
                  }
                  style={{ marginTop: "var(--bam-space-md)" }}
                >
                  <header
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "var(--bam-space-md)",
                      flexWrap: "wrap",
                      marginBottom: "var(--bam-space-md)",
                    }}
                  >
                    <h2 className="bam-title">
                      {chainLabel(d.chain)}
                      {d.label ? (
                        <span
                          style={{
                            fontFamily: "var(--bam-font-mono)",
                            fontSize: "var(--bam-t-label)",
                            color: "var(--bam-cream-40)",
                            letterSpacing: "0.1em",
                            marginLeft: "0.75rem",
                            textTransform: "uppercase",
                          }}
                        >
                          {d.label}
                        </span>
                      ) : null}
                    </h2>
                    <StateMarker state={d.coverageState} />
                  </header>

                  <p
                    className="bam-notice-body"
                    style={{ marginBottom: "var(--bam-space-md)" }}
                  >
                    {COVERAGE_MEANING[d.coverageState]}
                  </p>

                  <div className="bam-data-list">
                    <DataRow label="Address">
                      {d.explorerUrl ? (
                        <a
                          href={d.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "inherit" }}
                        >
                          {truncateAddress(d.addressOrProgramId)}
                        </a>
                      ) : (
                        truncateAddress(d.addressOrProgramId)
                      )}
                    </DataRow>
                    <DataRow label="Deployed commit">
                      {shortCommit(d.deployedCommit)}
                    </DataRow>
                    <DataRow label="TVL">{formatTvl(d.tvlUsd)}</DataRow>
                    <DataRow label="Drift (days)">
                      {formatDrift(d.driftDays)}
                    </DataRow>
                    <DataRow label="Deployed">{formatDate(d.deployedAt)}</DataRow>
                    <DataRow label="Last upgrade">
                      {formatDate(d.lastUpgradedAt)}
                    </DataRow>
                    <DataRow label="Recorded upgrades">
                      {String(d.upgradeCount)}
                    </DataRow>
                    <DataRow label="Upgradeable">
                      {d.isUpgradeable ? "Yes" : "No"}
                    </DataRow>
                    <DataRow label="Source verified">
                      {d.sourceVerified ? "Yes" : "No"}
                    </DataRow>
                    <DataRow label="Last checked">
                      {formatDate(d.lastCheckedAt)}
                    </DataRow>
                  </div>
                </article>
              </Reveal>
            ))}

            {protocol.deployments.length === 0 ? (
              <p className="bam-body" style={{ marginTop: "var(--bam-space-md)" }}>
                No deployments recorded.
              </p>
            ) : null}
          </div>
        </section>

        {/* ─── Audits ──────────────────────────────────────────────────── */}
        <section
          className="bam-pad-x"
          style={{ paddingBottom: "var(--bam-space-3xl)" }}
        >
          <div className="bam-wide">
            <Reveal>
              <p className="bam-eyebrow">AUDITS ON RECORD</p>
            </Reveal>

            {protocol.audits.length === 0 ? (
              <Reveal>
                <p className="bam-body" style={{ marginTop: "var(--bam-space-md)" }}>
                  No audits recorded for this protocol.
                </p>
              </Reveal>
            ) : (
              <Reveal>
                <div className="bam-table-scroll">
                  <table className="bam-table" style={{ marginTop: "var(--bam-space-md)" }}>
                    <thead>
                      <tr>
                        <th scope="col">Auditor</th>
                        <th scope="col">Report date</th>
                        <th scope="col">Reviewed commit</th>
                        <th scope="col" style={{ textAlign: "right" }}>Covers</th>
                        <th scope="col">Verified</th>
                        <th scope="col">Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {protocol.audits.map((a) => (
                        <tr key={a.id}>
                          <td className="bam-cell-name">{a.auditor}</td>
                          <td>{formatDate(a.reportDate)}</td>
                          <td>{shortCommit(a.reviewedCommit)}</td>
                          <td className="bam-cell-num">
                            {a.coversDeploymentIds.length}
                          </td>
                          <td style={{ color: "var(--bam-cream-60)" }}>
                            {a.verifiedByMe ? "Yes" : "No"}
                          </td>
                          <td>
                            {a.reportUrl ? (
                              <a
                                href={a.reportUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "var(--bam-cream-60)",
                                  textDecoration: "none",
                                  borderBottom: "1px solid var(--bam-cream-20)",
                                }}
                              >
                                Read
                              </a>
                            ) : (
                              EMPTY
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Reveal>
            )}

            <Reveal delay={100}>
              <p
                className="bam-body"
                style={{ marginTop: "var(--bam-space-xl)", fontSize: "0.8rem" }}
              >
                &ldquo;Covers&rdquo; counts the deployments an audit is recorded
                against. A deployment is only marked current when the covering
                audit&apos;s reviewed commit is an ancestor of the commit
                actually deployed on-chain.
              </p>
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}

function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bam-data-row">
      <span className="bam-data-key">{label}</span>
      <span className="bam-data-val">{children}</span>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bam-nav-page"
      style={{
        textDecoration: "none",
        borderBottom: "1px solid var(--bam-cream-20)",
        paddingBottom: "2px",
      }}
    >
      {label} ↗
    </a>
  );
}
