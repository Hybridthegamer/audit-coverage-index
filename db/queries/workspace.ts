import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  auditDeployments,
  audits,
  deployments,
  protocols,
  queueItems,
  upgradeEvents,
} from "@/db/schema";
import type { CoverageState } from "@/lib/drift";
import { computePriority } from "@/lib/priority";

/* ═══════════════════════════════════════════════════════════════════════════
   PRIVATE QUERY SURFACE — the workspace counterpart to db/queries/public.ts.

   Read exclusively by the authenticated /workspace routes, which the
   middleware gate stands in front of. Two things make it the deliberate
   opposite of the public surface:

     1. It does NOT apply the `published` predicate. The researcher works on
        targets before they are vetted and published, so the private queue must
        see unpublished protocols — the ones the public index hides. `archived`
        is still excluded; an archived target is retired from the workspace too.

     2. It MAY read the private queue_items table. It does not, in this build,
        touch findings, disclosure_events, leads, or outreach_events — those are
        step 5 (findings editor + disclosure timeline). Adding one of those
        imports is a step-5 change, not a refactor.

   priority_score is computed here at query time via lib/priority.ts and never
   stored (CLAUDE.md: "a separate, query-time computation, not a stored column").
   ═══════════════════════════════════════════════════════════════════════════ */

/** The workspace visibility predicate: everything that is not archived. */
const active = () => eq(protocols.archived, false);

/** Same severity ordering the public index uses, for stable secondary sorts. */
const byCoverageSeverity = sql`case ${deployments.coverageState}
    when 'uncovered' then 0
    when 'drifted'   then 1
    when 'current'   then 2
    else 3
  end`;

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type QueueStatus =
  | "candidate"
  | "queued"
  | "in_review"
  | "cleared"
  | "finding_found"
  | "dropped";

export interface QueueRow {
  deploymentId: number;
  protocolName: string;
  protocolSlug: string;
  isPublished: boolean;
  chain: string;
  addressOrProgramId: string;
  label: string | null;
  tvlUsd: number | null;
  isUpgradeable: boolean;
  hasBounty: boolean;
  coverageState: CoverageState;
  driftDays: number | null;
  /** Null when no queue item exists yet — the target is a bare candidate. */
  queueStatus: QueueStatus | null;
  /** Manual override priority off the queue item, if one was set. */
  manualPriority: number | null;
  queuedAt: Date | null;
  /** Computed here, never stored. Higher = review sooner. */
  priorityScore: number;
}

/** True while a queue item still wants the researcher's attention. */
const OPEN_STATUSES = new Set<QueueStatus | null>([
  null,
  "candidate",
  "queued",
  "in_review",
]);

/**
 * Every active target (published or not), ranked for review. Open items — those
 * still awaiting a verdict — sort above closed ones (cleared / dropped /
 * finding_found); within each group the computed priority_score leads, drift
 * breaks ties.
 *
 * The queue item is stitched on in JS (latest per deployment) rather than via a
 * join, so a deployment with two historical queue rows never multiplies here.
 */
export async function getQueue(): Promise<QueueRow[]> {
  const deploymentRows = await db
    .select({
      deploymentId: deployments.id,
      protocolName: protocols.name,
      protocolSlug: protocols.slug,
      isPublished: protocols.isPublished,
      hasBounty: protocols.hasBounty,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      label: deployments.label,
      tvlUsd: deployments.tvlUsd,
      isUpgradeable: deployments.isUpgradeable,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
    })
    .from(deployments)
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(active())
    .orderBy(byCoverageSeverity, sql`${deployments.driftDays} desc nulls last`);

  const queueRows = await db
    .select({
      deploymentId: queueItems.deploymentId,
      status: queueItems.status,
      priority: queueItems.priority,
      queuedAt: queueItems.queuedAt,
      createdAt: queueItems.createdAt,
    })
    .from(queueItems)
    .orderBy(desc(queueItems.createdAt));

  // First row wins per deployment — queueRows is newest-first.
  const latestByDeployment = new Map<number, (typeof queueRows)[number]>();
  for (const q of queueRows) {
    if (!latestByDeployment.has(q.deploymentId)) {
      latestByDeployment.set(q.deploymentId, q);
    }
  }

  const rows: QueueRow[] = deploymentRows.map((d) => {
    const q = latestByDeployment.get(d.deploymentId);
    const tvlUsd = toNumber(d.tvlUsd);
    return {
      deploymentId: d.deploymentId,
      protocolName: d.protocolName,
      protocolSlug: d.protocolSlug,
      isPublished: d.isPublished,
      chain: d.chain,
      addressOrProgramId: d.addressOrProgramId,
      label: d.label,
      tvlUsd,
      isUpgradeable: d.isUpgradeable,
      hasBounty: d.hasBounty,
      coverageState: d.coverageState,
      driftDays: d.driftDays,
      queueStatus: (q?.status ?? null) as QueueStatus | null,
      manualPriority: q?.priority ?? null,
      queuedAt: q?.queuedAt ?? null,
      priorityScore: computePriority({
        coverageState: d.coverageState,
        tvlUsd,
        driftDays: d.driftDays,
        hasBounty: d.hasBounty,
        isUpgradeable: d.isUpgradeable,
      }),
    };
  });

  return rows.sort((a, b) => {
    const aOpen = OPEN_STATUSES.has(a.queueStatus);
    const bOpen = OPEN_STATUSES.has(b.queueStatus);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return (b.driftDays ?? 0) - (a.driftDays ?? 0);
  });
}

export interface QueueCounts {
  total: number;
  open: number;
  uncovered: number;
  unpublished: number;
}

/** Small header tallies for the queue page. Derived from the ranked rows. */
export function summarizeQueue(rows: QueueRow[]): QueueCounts {
  let open = 0;
  let uncovered = 0;
  let unpublished = 0;
  for (const r of rows) {
    if (OPEN_STATUSES.has(r.queueStatus)) open += 1;
    if (r.coverageState === "uncovered") uncovered += 1;
    if (!r.isPublished) unpublished += 1;
  }
  return { total: rows.length, open, uncovered, unpublished };
}

export interface TargetAudit {
  id: number;
  auditor: string;
  reportUrl: string | null;
  reportDate: Date | null;
  reviewedCommit: string | null;
  scopeNote: string | null;
  source: string;
  verifiedByMe: boolean;
  covered: boolean;
}

export interface TargetUpgrade {
  id: number;
  occurredAt: Date;
  txHash: string | null;
  newImplementation: string | null;
  blockNumber: number | null;
}

export interface TargetQueueItem {
  status: QueueStatus;
  priority: number | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  closedAt: Date | null;
  clearReason: string | null;
  researchLog: string | null;
}

export interface TargetDetail {
  deploymentId: number;
  protocolName: string;
  protocolSlug: string;
  isPublished: boolean;
  website: string | null;
  githubRepo: string | null;
  twitter: string | null;
  securityContact: string | null;
  hasBounty: boolean;
  bountyPlatform: string;
  bountyUrl: string | null;
  chain: string;
  addressOrProgramId: string;
  label: string | null;
  tvlUsd: number | null;
  isUpgradeable: boolean;
  upgradeAuthority: string | null;
  deployedAt: Date | null;
  lastUpgradedAt: Date | null;
  deployedCommit: string | null;
  sourceVerified: boolean;
  explorerUrl: string | null;
  coverageState: CoverageState;
  driftDays: number | null;
  lastCheckedAt: Date | null;
  priorityScore: number;
  audits: TargetAudit[];
  upgrades: TargetUpgrade[];
  queueItem: TargetQueueItem | null;
}

/**
 * One target's full private record, keyed by deployment id. Returns null for an
 * unknown or archived deployment (the page turns that into a 404). Unlike the
 * public detail loader it does not require the protocol to be published.
 */
export async function getTarget(deploymentId: number): Promise<TargetDetail | null> {
  const [row] = await db
    .select({
      deploymentId: deployments.id,
      protocolId: protocols.id,
      protocolName: protocols.name,
      protocolSlug: protocols.slug,
      isPublished: protocols.isPublished,
      website: protocols.website,
      githubRepo: protocols.githubRepo,
      twitter: protocols.twitter,
      securityContact: protocols.securityContact,
      hasBounty: protocols.hasBounty,
      bountyPlatform: protocols.bountyPlatform,
      bountyUrl: protocols.bountyUrl,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      label: deployments.label,
      tvlUsd: deployments.tvlUsd,
      isUpgradeable: deployments.isUpgradeable,
      upgradeAuthority: deployments.upgradeAuthority,
      deployedAt: deployments.deployedAt,
      lastUpgradedAt: deployments.lastUpgradedAt,
      deployedCommit: deployments.deployedCommit,
      sourceVerified: deployments.sourceVerified,
      explorerUrl: deployments.explorerUrl,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
      lastCheckedAt: deployments.lastCheckedAt,
    })
    .from(deployments)
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(and(active(), eq(deployments.id, deploymentId)))
    .limit(1);

  if (!row) return null;

  const auditRows = await db
    .select({
      id: audits.id,
      auditor: audits.auditor,
      reportUrl: audits.reportUrl,
      reportDate: audits.reportDate,
      reviewedCommit: audits.reviewedCommit,
      scopeNote: audits.scopeNote,
      source: audits.source,
      verifiedByMe: audits.verifiedByMe,
      covered: sql<boolean>`exists (
        select 1 from ${auditDeployments}
        where ${auditDeployments.auditId} = ${audits.id}
          and ${auditDeployments.deploymentId} = ${deploymentId}
      )`,
    })
    .from(audits)
    .where(eq(audits.protocolId, row.protocolId))
    .orderBy(sql`${audits.reportDate} desc nulls last`, desc(audits.id));

  const upgradeRows = await db
    .select({
      id: upgradeEvents.id,
      occurredAt: upgradeEvents.occurredAt,
      txHash: upgradeEvents.txHash,
      newImplementation: upgradeEvents.newImplementation,
      blockNumber: upgradeEvents.blockNumber,
    })
    .from(upgradeEvents)
    .where(eq(upgradeEvents.deploymentId, deploymentId))
    .orderBy(desc(upgradeEvents.occurredAt));

  const [queueRow] = await db
    .select({
      status: queueItems.status,
      priority: queueItems.priority,
      queuedAt: queueItems.queuedAt,
      startedAt: queueItems.startedAt,
      closedAt: queueItems.closedAt,
      clearReason: queueItems.clearReason,
      researchLog: queueItems.researchLog,
    })
    .from(queueItems)
    .where(eq(queueItems.deploymentId, deploymentId))
    .orderBy(desc(queueItems.createdAt))
    .limit(1);

  const tvlUsd = toNumber(row.tvlUsd);

  return {
    deploymentId: row.deploymentId,
    protocolName: row.protocolName,
    protocolSlug: row.protocolSlug,
    isPublished: row.isPublished,
    website: row.website,
    githubRepo: row.githubRepo,
    twitter: row.twitter,
    securityContact: row.securityContact,
    hasBounty: row.hasBounty,
    bountyPlatform: row.bountyPlatform,
    bountyUrl: row.bountyUrl,
    chain: row.chain,
    addressOrProgramId: row.addressOrProgramId,
    label: row.label,
    tvlUsd,
    isUpgradeable: row.isUpgradeable,
    upgradeAuthority: row.upgradeAuthority,
    deployedAt: row.deployedAt,
    lastUpgradedAt: row.lastUpgradedAt,
    deployedCommit: row.deployedCommit,
    sourceVerified: row.sourceVerified,
    explorerUrl: row.explorerUrl,
    coverageState: row.coverageState,
    driftDays: row.driftDays,
    lastCheckedAt: row.lastCheckedAt,
    priorityScore: computePriority({
      coverageState: row.coverageState,
      tvlUsd,
      driftDays: row.driftDays,
      hasBounty: row.hasBounty,
      isUpgradeable: row.isUpgradeable,
    }),
    audits: auditRows,
    upgrades: upgradeRows,
    queueItem: (queueRow as TargetQueueItem | undefined) ?? null,
  };
}
