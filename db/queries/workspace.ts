import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  auditDeployments,
  audits,
  deployments,
  disclosureEvents,
  findings,
  protocols,
  queueItems,
  upgradeEvents,
} from "@/db/schema";
import type { CoverageState } from "@/lib/drift";
import {
  computePriority,
  computeProtocolPriority,
  type AuditStatus,
} from "@/lib/priority";
import type { SubmissionContext } from "@/lib/submission";

/* ═══════════════════════════════════════════════════════════════════════════
   PRIVATE QUERY SURFACE — the workspace counterpart to db/queries/public.ts.

   Read exclusively by the authenticated /workspace routes, which the
   middleware gate stands in front of. Two things make it the deliberate
   opposite of the public surface:

     1. It does NOT apply the `published` predicate. The researcher works on
        targets before they are vetted and published, so the private queue must
        see unpublished protocols — the ones the public index hides. `archived`
        is still excluded; an archived target is retired from the workspace too.

     2. It MAY read the private queue_items, findings, and disclosure_events
        tables (findings editor + disclosure timeline landed in step 5). It
        still does NOT touch leads or outreach_events — the commercial pipeline
        is a separate concern; adding one of those imports is a new decision,
        not a refactor. Nothing here is ever reachable from a public route.

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

/**
 * The curation-layer signal (step 6): does this protocol have ANY audit on
 * record? Derived at query time from the audits table — deliberately not a
 * stored column, and deliberately not conflated with coverage_state. "Audited"
 * here means only "somebody reviewed this project at some point"; whether the
 * currently deployed code is what they reviewed is the harder question that
 * coverage_state answers, and it stays `unknown` until step 7 pins commits.
 */
const auditStatusSql = sql<AuditStatus>`case when exists (
    select 1 from ${audits} where ${audits.protocolId} = ${protocols.id}
  ) then 'audited' else 'unaudited' end`;

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
  /** Protocol-level audit presence (step 6). Not the same as coverageState. */
  auditStatus: AuditStatus;
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
      auditStatus: auditStatusSql,
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
      auditStatus: d.auditStatus,
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
  unaudited: number;
}

/** Small header tallies for the queue page. Derived from the ranked rows. */
export function summarizeQueue(rows: QueueRow[]): QueueCounts {
  let open = 0;
  let uncovered = 0;
  let unpublished = 0;
  let unaudited = 0;
  for (const r of rows) {
    if (OPEN_STATUSES.has(r.queueStatus)) open += 1;
    if (r.coverageState === "uncovered") uncovered += 1;
    if (!r.isPublished) unpublished += 1;
    if (r.auditStatus === "unaudited") unaudited += 1;
  }
  return { total: rows.length, open, uncovered, unpublished, unaudited };
}

/* ─── Sourced protocols with no deployments yet (step 6) ───────────────────
   DefiLlama gives no contract addresses, so a freshly sourced protocol has no
   deployment rows — and `deployments.address_or_program_id` is NOT NULL, so
   the sync will not fabricate one. getQueue() above is keyed on deployments
   and therefore cannot see these protocols at all.

   They are still targets: an unaudited protocol holding $80M is worth pinning
   contracts for even though nothing on-chain has been recorded yet. This query
   surfaces them as a second, protocol-level list ranked by
   computeProtocolPriority, and step 7 graduates them into the real queue as it
   creates their deployments. */

export interface SourcedProtocolRow {
  protocolId: number;
  name: string;
  slug: string;
  website: string | null;
  githubRepo: string | null;
  twitter: string | null;
  isPublished: boolean;
  hasBounty: boolean;
  tvlUsd: number | null;
  auditStatus: AuditStatus;
  /** How many DefiLlama report links (and markers) we hold for it. */
  auditCount: number;
  /** Computed here, never stored. Higher = pin its contracts sooner. */
  priorityScore: number;
}

export interface SourcedProtocolList {
  rows: SourcedProtocolRow[];
  /** Total matching protocols, before `limit` — the list is long by design. */
  total: number;
  unaudited: number;
}

/**
 * Active protocols with zero deployment rows, ranked. `limit` caps the rendered
 * table (a $1M-floor DefiLlama sync lands ~1,300 of these); the counts describe
 * the whole set so the page can say what it is not showing.
 */
export async function getSourcedProtocols(limit = 100): Promise<SourcedProtocolList> {
  const rows = await db
    .select({
      protocolId: protocols.id,
      name: protocols.name,
      slug: protocols.slug,
      website: protocols.website,
      githubRepo: protocols.githubRepo,
      twitter: protocols.twitter,
      isPublished: protocols.isPublished,
      hasBounty: protocols.hasBounty,
      tvlUsd: protocols.tvlUsd,
      auditStatus: auditStatusSql,
      auditCount: sql<number>`(
        select count(*)::int from ${audits}
        where ${audits.protocolId} = ${protocols.id}
      )`,
    })
    .from(protocols)
    .where(
      and(
        active(),
        sql`not exists (
          select 1 from ${deployments}
          where ${deployments.protocolId} = ${protocols.id}
        )`,
      ),
    );

  const ranked = rows
    .map((r) => {
      const tvlUsd = toNumber(r.tvlUsd);
      return {
        ...r,
        tvlUsd,
        priorityScore: computeProtocolPriority({
          auditStatus: r.auditStatus,
          tvlUsd,
          hasBounty: r.hasBounty,
        }),
      };
    })
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) ||
        a.name.localeCompare(b.name),
    );

  return {
    rows: ranked.slice(0, limit),
    total: ranked.length,
    unaudited: ranked.filter((r) => r.auditStatus === "unaudited").length,
  };
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

/* ─── Findings + disclosure (step 5) ───────────────────────────────────────
   Private, per-deployment. Reachable only through the authenticated workspace;
   the public surface (db/queries/public.ts) still never imports these tables. */

export interface FindingSummary {
  id: number;
  title: string;
  severity: string | null;
  status: string;
  immunefiClass: string | null;
  fundsAtRiskUsd: number | null;
  inPostAuditCode: boolean;
  disclosureCount: number;
  createdAt: Date;
}

/** Every finding filed against one deployment, newest first, with event counts. */
export async function getFindingsForDeployment(
  deploymentId: number,
): Promise<FindingSummary[]> {
  const rows = await db
    .select({
      id: findings.id,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
      immunefiClass: findings.immunefiClass,
      fundsAtRiskUsd: findings.fundsAtRiskUsd,
      inPostAuditCode: findings.inPostAuditCode,
      createdAt: findings.createdAt,
      disclosureCount: sql<number>`(
        select count(*)::int from ${disclosureEvents}
        where ${disclosureEvents.findingId} = ${findings.id}
      )`,
    })
    .from(findings)
    .where(eq(findings.deploymentId, deploymentId))
    .orderBy(desc(findings.createdAt));

  return rows.map((r) => ({ ...r, fundsAtRiskUsd: toNumber(r.fundsAtRiskUsd) }));
}

export interface DisclosureEvent {
  id: number;
  eventType: string;
  occurredAt: Date;
  channel: string | null;
  note: string | null;
}

export interface FindingDetail {
  id: number;
  deploymentId: number;
  protocolName: string;
  protocolSlug: string;
  deploymentLabel: string | null;
  chain: string;
  addressOrProgramId: string;
  title: string;
  severity: string | null;
  immunefiClass: string | null;
  fundsAtRiskUsd: number | null;
  status: string;
  summary: string | null;
  rootCause: string | null;
  attackPath: string | null;
  preconditions: string | null;
  impact: string | null;
  recommendedFix: string | null;
  /** Pointer only (repo URL / gist id / local path). Never runnable code. */
  pocRef: string | null;
  inPostAuditCode: boolean;
  createdAt: Date;
  disclosureEvents: DisclosureEvent[];
}

/**
 * One finding with its deployment/protocol context and full disclosure
 * timeline. Returns null for an unknown id (the page 404s). `poc_ref` is the
 * only PoC field there is — a string pointer; runnable exploits never live in
 * this database (CLAUDE.md hard constraint).
 */
export async function getFinding(findingId: number): Promise<FindingDetail | null> {
  const [row] = await db
    .select({
      id: findings.id,
      deploymentId: findings.deploymentId,
      protocolName: protocols.name,
      protocolSlug: protocols.slug,
      deploymentLabel: deployments.label,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      title: findings.title,
      severity: findings.severity,
      immunefiClass: findings.immunefiClass,
      fundsAtRiskUsd: findings.fundsAtRiskUsd,
      status: findings.status,
      summary: findings.summary,
      rootCause: findings.rootCause,
      attackPath: findings.attackPath,
      preconditions: findings.preconditions,
      impact: findings.impact,
      recommendedFix: findings.recommendedFix,
      pocRef: findings.pocRef,
      inPostAuditCode: findings.inPostAuditCode,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .innerJoin(deployments, eq(findings.deploymentId, deployments.id))
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(eq(findings.id, findingId))
    .limit(1);

  if (!row) return null;

  const events = await db
    .select({
      id: disclosureEvents.id,
      eventType: disclosureEvents.eventType,
      occurredAt: disclosureEvents.occurredAt,
      channel: disclosureEvents.channel,
      note: disclosureEvents.note,
    })
    .from(disclosureEvents)
    .where(eq(disclosureEvents.findingId, findingId))
    .orderBy(desc(disclosureEvents.occurredAt), desc(disclosureEvents.id));

  return {
    ...row,
    fundsAtRiskUsd: toNumber(row.fundsAtRiskUsd),
    disclosureEvents: events,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 7 — the protocol-level detail page, and the submission context.

   Two additions, both private, both inside the boundary this file has held
   since step 4: no `published` predicate, `archived` still excluded, and still
   no import of leads or outreach_events.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ProtocolAuditRow {
  id: number;
  auditor: string;
  reportUrl: string | null;
  reportDate: Date | null;
  reviewedCommit: string | null;
  scopeNote: string | null;
  source: string;
  verifiedByMe: boolean;
}

export interface ProtocolDeploymentRow {
  deploymentId: number;
  chain: string;
  addressOrProgramId: string;
  label: string | null;
  coverageState: CoverageState;
  driftDays: number | null;
  isUpgradeable: boolean;
  deployedCommit: string | null;
  deployedAt: Date | null;
  lastUpgradedAt: Date | null;
  sourceVerified: boolean;
  explorerUrl: string | null;
  lastCheckedAt: Date | null;
  upgradeCount: number;
}

export interface ProtocolDetail {
  protocolId: number;
  name: string;
  slug: string;
  website: string | null;
  githubRepo: string | null;
  twitter: string | null;
  securityContact: string | null;
  isPublished: boolean;
  hasBounty: boolean;
  bountyPlatform: string;
  bountyUrl: string | null;
  tvlUsd: number | null;
  auditStatus: AuditStatus;
  /** Query-time protocol ranking. Only meaningful before contracts are pinned. */
  priorityScore: number;
  deployments: ProtocolDeploymentRow[];
  audits: ProtocolAuditRow[];
}

/**
 * One protocol's private record, keyed by protocol id (not deployment id).
 *
 * getTarget() above is keyed on a DEPLOYMENT and therefore cannot see a
 * protocol that has none — which, after step 6, is roughly nine hundred of
 * them. This is the page where a sourced protocol gets its contracts pinned and
 * so becomes a target at all: the step-6 queue's second table links here, and
 * pinning one address is what graduates it into getQueue().
 */
export async function getProtocolDetail(
  protocolId: number,
): Promise<ProtocolDetail | null> {
  const [row] = await db
    .select({
      protocolId: protocols.id,
      name: protocols.name,
      slug: protocols.slug,
      website: protocols.website,
      githubRepo: protocols.githubRepo,
      twitter: protocols.twitter,
      securityContact: protocols.securityContact,
      isPublished: protocols.isPublished,
      hasBounty: protocols.hasBounty,
      bountyPlatform: protocols.bountyPlatform,
      bountyUrl: protocols.bountyUrl,
      tvlUsd: protocols.tvlUsd,
      auditStatus: auditStatusSql,
    })
    .from(protocols)
    .where(and(active(), eq(protocols.id, protocolId)))
    .limit(1);

  if (!row) return null;

  const deploymentRows = await db
    .select({
      deploymentId: deployments.id,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      label: deployments.label,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
      isUpgradeable: deployments.isUpgradeable,
      deployedCommit: deployments.deployedCommit,
      deployedAt: deployments.deployedAt,
      lastUpgradedAt: deployments.lastUpgradedAt,
      sourceVerified: deployments.sourceVerified,
      explorerUrl: deployments.explorerUrl,
      lastCheckedAt: deployments.lastCheckedAt,
      upgradeCount: sql<number>`(
        select count(*)::int from ${upgradeEvents}
        where ${upgradeEvents.deploymentId} = ${deployments.id}
      )`,
    })
    .from(deployments)
    .where(eq(deployments.protocolId, protocolId))
    .orderBy(byCoverageSeverity, desc(deployments.id));

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
    })
    .from(audits)
    .where(eq(audits.protocolId, protocolId))
    .orderBy(sql`${audits.reportDate} desc nulls last`, desc(audits.id));

  const tvlUsd = toNumber(row.tvlUsd);

  return {
    ...row,
    tvlUsd,
    priorityScore: computeProtocolPriority({
      auditStatus: row.auditStatus,
      tvlUsd,
      hasBounty: row.hasBounty,
    }),
    deployments: deploymentRows,
    audits: auditRows,
  };
}

/**
 * Everything lib/submission.ts needs to render the three artefacts, in one
 * query pass.
 *
 * `getFinding` above deliberately stops at the finding and its timeline; a
 * submission also needs the protocol's security contact and bounty, the
 * deployment's commit and coverage verdict, and the audit that should have
 * covered the code. Rather than widen getFinding for every caller, this is its
 * own loader — the same reason getTarget and getQueue are separate.
 *
 * The covering audit is chosen the way computeDrift chooses it: the most recent
 * LINKED audit by report date. That link is the researcher's recorded ancestry
 * assertion, so an unlinked audit is never offered as cover for a claim made in
 * an email to a protocol team.
 */
export async function getSubmissionContext(
  findingId: number,
): Promise<SubmissionContext | null> {
  const [row] = await db
    .select({
      protocolName: protocols.name,
      securityContact: protocols.securityContact,
      website: protocols.website,
      githubRepo: protocols.githubRepo,
      hasBounty: protocols.hasBounty,
      bountyPlatform: protocols.bountyPlatform,
      bountyUrl: protocols.bountyUrl,
      chain: deployments.chain,
      addressOrProgramId: deployments.addressOrProgramId,
      deploymentLabel: deployments.label,
      deployedCommit: deployments.deployedCommit,
      explorerUrl: deployments.explorerUrl,
      coverageState: deployments.coverageState,
      driftDays: deployments.driftDays,
      deploymentId: deployments.id,
      title: findings.title,
      severity: findings.severity,
      immunefiClass: findings.immunefiClass,
      fundsAtRiskUsd: findings.fundsAtRiskUsd,
      summary: findings.summary,
      rootCause: findings.rootCause,
      attackPath: findings.attackPath,
      preconditions: findings.preconditions,
      impact: findings.impact,
      recommendedFix: findings.recommendedFix,
      pocRef: findings.pocRef,
      inPostAuditCode: findings.inPostAuditCode,
    })
    .from(findings)
    .innerJoin(deployments, eq(findings.deploymentId, deployments.id))
    .innerJoin(protocols, eq(deployments.protocolId, protocols.id))
    .where(eq(findings.id, findingId))
    .limit(1);

  if (!row) return null;

  const [covering] = await db
    .select({
      auditor: audits.auditor,
      reportDate: audits.reportDate,
      reviewedCommit: audits.reviewedCommit,
      reportUrl: audits.reportUrl,
    })
    .from(auditDeployments)
    .innerJoin(audits, eq(auditDeployments.auditId, audits.id))
    .where(eq(auditDeployments.deploymentId, row.deploymentId))
    .orderBy(sql`${audits.reportDate} desc nulls last`, desc(audits.id))
    .limit(1);

  const [firstContact] = await db
    .select({ occurredAt: disclosureEvents.occurredAt })
    .from(disclosureEvents)
    .where(
      and(
        eq(disclosureEvents.findingId, findingId),
        eq(disclosureEvents.eventType, "initial_contact"),
      ),
    )
    .orderBy(disclosureEvents.occurredAt)
    .limit(1);

  return {
    ...row,
    fundsAtRiskUsd: toNumber(row.fundsAtRiskUsd),
    coveringAudit: covering ?? null,
    firstContactAt: firstContact?.occurredAt ?? null,
  };
}
