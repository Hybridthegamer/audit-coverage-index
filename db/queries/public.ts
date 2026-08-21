import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  auditDeployments,
  audits,
  deployments,
  protocols,
  upgradeEvents,
} from "@/db/schema";
import type { CoverageState } from "@/lib/drift";

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC QUERY SURFACE — the security boundary.

   Every loader behind an indexed, unauthenticated route reads through this
   module and nothing else. It imports exactly five tables:

       protocols · deployments · audits · audit_deployments · upgrade_events

   It must NEVER import or join findings, disclosure_events, leads, or
   outreach_events. Those describe unreported vulnerabilities and commercial
   pipeline; a join here would publish them. The import list above is the
   enforcement point — keep it closed, and treat any addition to it as a
   security change rather than a refactor.

   Visibility is filtered, not merely defaulted: `published()` gates every
   query on is_published AND NOT archived, so an unvetted protocol stays
   invisible even to something that links straight at its slug.

   One operational caveat, verified against a real build: because the public
   routes are ISR-cached, flipping is_published to false removes a protocol at
   the next revalidation (<= 1h) or rebuild — NOT instantly. The detail page
   404s as soon as its own entry revalidates, but an already-rendered /index or
   sitemap keeps listing it until theirs does. Unpublishing is therefore a
   takedown with a delay, not a kill switch; when step 5's ingest worker starts
   writing visibility it should call revalidatePath() for `/`, `/coverage` and
   the affected `/protocols/[slug]` so the change lands immediately.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The visibility predicate. Every exported query in this file applies it. */
const published = () =>
  and(eq(protocols.isPublished, true), eq(protocols.archived, false));

/**
 * Coverage-state sort: the editorial argument the index makes. Uncovered
 * first (the reserved-red rows), then drifted, then current, then unknown.
 */
const byCoverageSeverity = sql`case ${deployments.coverageState}
    when 'uncovered' then 0
    when 'drifted'   then 1
    when 'current'   then 2
    else 3
  end`;

/** Postgres `numeric` arrives as a string; hand the UI a number or nothing. */
function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface IndexRow {
  deploymentId: number;
  protocolName: string;
  protocolSlug: string;
  chain: string;
  addressOrProgramId: string;
  label: string | null;
  tvlUsd: number | null;
  isUpgradeable: boolean;
  coverageState: CoverageState;
  driftDays: number | null;
  lastUpgradedAt: Date | null;
  deployedAt: Date | null;
  explorerUrl: string | null;
}

/**
 * Every published deployment, one row each — the coverage index.
 *
 * Within a coverage state the longest drift leads; NULLS LAST keeps unmeasured
 * drift off the top.
 */
export async function getIndexRows(): Promise<IndexRow[]> {
  const rows = await db
    .select({
      deploymentId: deployments.id,
      protocolName: protocols.name,
      protocolSlug: protocols.slug,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      label: deployments.label,
      tvlUsd: deployments.tvlUsd,
      isUpgradeable: deployments.isUpgradeable,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
      lastUpgradedAt: deployments.lastUpgradedAt,
      deployedAt: deployments.deployedAt,
      explorerUrl: deployments.explorerUrl,
    })
    .from(deployments)
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(published())
    .orderBy(
      byCoverageSeverity,
      sql`${deployments.driftDays} desc nulls last`,
      asc(protocols.name),
    );

  return rows.map((r) => ({ ...r, tvlUsd: toNumber(r.tvlUsd) }));
}

export type CoverageSummary = Record<CoverageState, number> & {
  total: number;
  protocolCount: number;
  /** Summed TVL of deployments in the `uncovered` state. */
  uncoveredTvlUsd: number;
};

/**
 * Headline counts for the landing page. Aggregated in Postgres rather than by
 * counting getIndexRows() in JS, so the hero stays one round trip.
 */
export async function getCoverageSummary(): Promise<CoverageSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      protocolCount: sql<number>`count(distinct ${protocols.id})::int`,
      current: sql<number>`count(*) filter (where ${deployments.coverageState} = 'current')::int`,
      drifted: sql<number>`count(*) filter (where ${deployments.coverageState} = 'drifted')::int`,
      uncovered: sql<number>`count(*) filter (where ${deployments.coverageState} = 'uncovered')::int`,
      unknown: sql<number>`count(*) filter (where ${deployments.coverageState} = 'unknown')::int`,
      uncoveredTvlUsd: sql<string>`coalesce(sum(${deployments.tvlUsd}) filter (where ${deployments.coverageState} = 'uncovered'), 0)::text`,
    })
    .from(deployments)
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(published());

  return {
    total: row?.total ?? 0,
    protocolCount: row?.protocolCount ?? 0,
    current: row?.current ?? 0,
    drifted: row?.drifted ?? 0,
    uncovered: row?.uncovered ?? 0,
    unknown: row?.unknown ?? 0,
    uncoveredTvlUsd: toNumber(row?.uncoveredTvlUsd ?? null) ?? 0,
  };
}

/** Slugs of every published protocol — drives generateStaticParams + sitemap. */
export async function getPublishedSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: protocols.slug })
    .from(protocols)
    .where(published())
    .orderBy(asc(protocols.slug));

  return rows.map((r) => r.slug);
}

export interface ProtocolAudit {
  id: number;
  auditor: string;
  reportUrl: string | null;
  reportDate: Date | null;
  reviewedCommit: string | null;
  scopeNote: string | null;
  verifiedByMe: boolean;
  /** Deployment ids this audit is recorded as covering. */
  coversDeploymentIds: number[];
}

export interface ProtocolDeployment extends IndexRow {
  deployedCommit: string | null;
  sourceVerified: boolean;
  upgradeCount: number;
  lastCheckedAt: Date | null;
}

export interface ProtocolDetail {
  name: string;
  slug: string;
  website: string | null;
  githubRepo: string | null;
  twitter: string | null;
  hasBounty: boolean;
  bountyPlatform: string;
  bountyUrl: string | null;
  publicNote: string | null;
  deployments: ProtocolDeployment[];
  audits: ProtocolAudit[];
}

/**
 * One protocol's full public record. Returns null for an unknown, unpublished
 * or archived slug — the caller turns that into a 404, so an unpublished
 * protocol is indistinguishable from one that never existed.
 */
export async function getProtocolBySlug(
  slug: string,
): Promise<ProtocolDetail | null> {
  const [protocol] = await db
    .select({
      id: protocols.id,
      name: protocols.name,
      slug: protocols.slug,
      website: protocols.website,
      githubRepo: protocols.githubRepo,
      twitter: protocols.twitter,
      hasBounty: protocols.hasBounty,
      bountyPlatform: protocols.bountyPlatform,
      bountyUrl: protocols.bountyUrl,
      publicNote: protocols.publicNote,
    })
    .from(protocols)
    .where(and(published(), eq(protocols.slug, slug)))
    .limit(1);

  if (!protocol) return null;

  const deploymentRows = await db
    .select({
      deploymentId: deployments.id,
      protocolName: protocols.name,
      protocolSlug: protocols.slug,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      label: deployments.label,
      tvlUsd: deployments.tvlUsd,
      isUpgradeable: deployments.isUpgradeable,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
      lastUpgradedAt: deployments.lastUpgradedAt,
      deployedAt: deployments.deployedAt,
      explorerUrl: deployments.explorerUrl,
      deployedCommit: deployments.deployedCommit,
      sourceVerified: deployments.sourceVerified,
      lastCheckedAt: deployments.lastCheckedAt,
      upgradeCount: sql<number>`(
        select count(*)::int from ${upgradeEvents}
        where ${upgradeEvents.deploymentId} = ${deployments.id}
      )`,
    })
    .from(deployments)
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(and(published(), eq(protocols.id, protocol.id)))
    .orderBy(byCoverageSeverity, asc(deployments.chain));

  // Audits, plus which deployments each one covers. Two flat reads assembled
  // in JS rather than one row-multiplying join.
  const auditRows = await db
    .select({
      id: audits.id,
      auditor: audits.auditor,
      reportUrl: audits.reportUrl,
      reportDate: audits.reportDate,
      reviewedCommit: audits.reviewedCommit,
      scopeNote: audits.scopeNote,
      verifiedByMe: audits.verifiedByMe,
    })
    .from(audits)
    .where(eq(audits.protocolId, protocol.id))
    .orderBy(sql`${audits.reportDate} desc nulls last`, desc(audits.id));

  const coverageRows = auditRows.length
    ? await db
        .select({
          auditId: auditDeployments.auditId,
          deploymentId: auditDeployments.deploymentId,
        })
        .from(auditDeployments)
        .innerJoin(audits, eq(auditDeployments.auditId, audits.id))
        .where(eq(audits.protocolId, protocol.id))
    : [];

  const coversByAudit = new Map<number, number[]>();
  for (const { auditId, deploymentId } of coverageRows) {
    const list = coversByAudit.get(auditId);
    if (list) list.push(deploymentId);
    else coversByAudit.set(auditId, [deploymentId]);
  }

  return {
    name: protocol.name,
    slug: protocol.slug,
    website: protocol.website,
    githubRepo: protocol.githubRepo,
    twitter: protocol.twitter,
    hasBounty: protocol.hasBounty,
    bountyPlatform: protocol.bountyPlatform,
    bountyUrl: protocol.bountyUrl,
    publicNote: protocol.publicNote,
    deployments: deploymentRows.map((r) => ({
      ...r,
      tvlUsd: toNumber(r.tvlUsd),
    })),
    audits: auditRows.map((a) => ({
      ...a,
      coversDeploymentIds: coversByAudit.get(a.id) ?? [],
    })),
  };
}
