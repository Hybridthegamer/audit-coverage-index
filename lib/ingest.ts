import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { eq, inArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { computeDrift, type CandidateAudit, type CoverageState } from "@/lib/drift";
import type { SourcedProtocol } from "@/lib/sources/defillama";

/**
 * Ingest modules (build steps 5 and 6). The recompute pipeline that turns raw
 * deployment + audit rows into the two public numbers — coverage_state and
 * drift_days — and seeds the private research queue with candidates.
 *
 * Deliberately NOT server-only and it imports no DB client: every function
 * takes the drizzle instance as an argument, exactly like db/seed.ts builds its
 * own. That lets the same code run three ways:
 *   · the CLI runner (scripts/ingest.ts), under tsx with its own Neon HTTP conn
 *   · an authenticated in-app action, against db/client, which can then call
 *     revalidatePath() so a coverage change lands on the public pages at once
 *   · tests, against pure helpers exported here
 *
 * The git work stays here, off the pure computeDrift() (CLAUDE.md, step 1):
 * ancestry is resolved with `git merge-base --is-ancestor` and the boolean is
 * what recompute feeds the function. recomputeDrift() itself trusts the
 * audit_deployments join as the recorded ancestry — that link IS the assertion
 * "this audit covers this deployment", which a real source run established with
 * resolveGitAncestry() before writing the link.
 */

type DB = NeonHttpDatabase<typeof schema>;

const execFileAsync = promisify(execFile);

/**
 * True when `reviewedCommit` is an ancestor of `deployedCommit` in the repo at
 * `repoPath`. This is the one place git is shelled out to; it feeds the
 * `isAncestorOfDeployed` boolean that computeDrift() consumes but never derives.
 *
 * Fails closed: a missing repo, a missing commit, or a non-zero exit (the two
 * commits are unrelated, or one is unknown to the repo) all return false rather
 * than throwing, so one unresolvable pair cannot abort a whole ingest run.
 */
export async function resolveGitAncestry(
  reviewedCommit: string | null,
  deployedCommit: string | null,
  repoPath: string,
): Promise<boolean> {
  if (!reviewedCommit || !deployedCommit) return false;
  try {
    await execFileAsync(
      "git",
      ["-C", repoPath, "merge-base", "--is-ancestor", reviewedCommit, deployedCommit],
      { timeout: 15_000 },
    );
    return true; // exit 0 => ancestor
  } catch {
    return false; // exit 1 => not an ancestor; anything else => unresolvable
  }
}

/**
 * The queue-candidate predicate, pulled out pure so it can be tested without a
 * database. A deployment earns a candidate queue item when its code is live and
 * unreviewed — uncovered or drifted — and nothing open is already tracking it.
 */
export function needsCandidate(
  coverageState: CoverageState,
  hasOpenQueueItem: boolean,
): boolean {
  if (hasOpenQueueItem) return false;
  return coverageState === "uncovered" || coverageState === "drifted";
}

/** Queue statuses that still count as "open" — a candidate must not duplicate one. */
const OPEN_QUEUE_STATUSES = ["candidate", "queued", "in_review"] as const;

export interface RecomputeSummary {
  checked: number;
  changed: number;
  byState: Record<CoverageState, number>;
}

/**
 * Recompute coverage_state + drift_days for every deployment from the audit
 * linkage, via the single source of truth (computeDrift). Writes last_checked_at
 * on every row and the new state/drift only where they moved. Returns a tally.
 */
export async function recomputeDrift(db: DB, now: Date = new Date()): Promise<RecomputeSummary> {
  const deployments = await db
    .select({
      id: schema.deployments.id,
      deployedCommit: schema.deployments.deployedCommit,
      lastUpgradedAt: schema.deployments.lastUpgradedAt,
      deployedAt: schema.deployments.deployedAt,
      coverageState: schema.deployments.coverageState,
      driftDays: schema.deployments.driftDays,
    })
    .from(schema.deployments);

  // The recorded ancestry: audit_deployments joined to its audit's commit+date.
  const links = await db
    .select({
      deploymentId: schema.auditDeployments.deploymentId,
      reviewedCommit: schema.audits.reviewedCommit,
      reportDate: schema.audits.reportDate,
    })
    .from(schema.auditDeployments)
    .innerJoin(schema.audits, eq(schema.auditDeployments.auditId, schema.audits.id));

  const auditsByDeployment = new Map<number, CandidateAudit[]>();
  for (const link of links) {
    const list = auditsByDeployment.get(link.deploymentId) ?? [];
    list.push({
      reviewedCommit: link.reviewedCommit,
      reportDate: link.reportDate,
      // The link is the recorded proof of ancestry (see module header).
      isAncestorOfDeployed: true,
    });
    auditsByDeployment.set(link.deploymentId, list);
  }

  const byState: Record<CoverageState, number> = {
    current: 0,
    drifted: 0,
    uncovered: 0,
    unknown: 0,
  };
  let changed = 0;

  for (const d of deployments) {
    const result = computeDrift({
      deployedCommit: d.deployedCommit,
      lastUpgradedAt: d.lastUpgradedAt,
      deployedAt: d.deployedAt,
      candidateAudits: auditsByDeployment.get(d.id) ?? [],
      now,
    });

    byState[result.coverageState] += 1;

    const moved =
      result.coverageState !== d.coverageState || result.driftDays !== d.driftDays;
    if (moved) changed += 1;

    await db
      .update(schema.deployments)
      .set({
        coverageState: result.coverageState,
        driftDays: result.driftDays,
        lastCheckedAt: now,
      })
      .where(eq(schema.deployments.id, d.id));
  }

  return { checked: deployments.length, changed, byState };
}

/**
 * Insert a `candidate` queue item for every uncovered/drifted deployment that
 * has no open queue item yet. Idempotent: re-running never double-queues.
 * Returns how many candidates were created.
 */
export async function syncQueueCandidates(db: DB, now: Date = new Date()): Promise<number> {
  const deployments = await db
    .select({
      id: schema.deployments.id,
      coverageState: schema.deployments.coverageState,
    })
    .from(schema.deployments);

  const openRows = await db
    .select({ deploymentId: schema.queueItems.deploymentId })
    .from(schema.queueItems)
    .where(inArray(schema.queueItems.status, [...OPEN_QUEUE_STATUSES]));

  const hasOpen = new Set(openRows.map((r) => r.deploymentId));

  const toCreate = deployments
    .filter((d) => needsCandidate(d.coverageState, hasOpen.has(d.id)))
    .map((d) => ({
      deploymentId: d.id,
      status: "candidate" as const,
      researchLog: `# Candidate\n\nAuto-queued by ingest on ${now
        .toISOString()
        .slice(0, 10)} — coverage is ${d.coverageState}.`,
    }));

  if (toCreate.length === 0) return 0;

  await db.insert(schema.queueItems).values(toCreate);
  return toCreate.length;
}

export interface IngestSummary {
  recompute: RecomputeSummary;
  candidatesCreated: number;
}

/** Full ingest pass: recompute drift, then top up the candidate queue. */
export async function runIngest(db: DB, now: Date = new Date()): Promise<IngestSummary> {
  const recompute = await recomputeDrift(db, now);
  const candidatesCreated = await syncQueueCandidates(db, now);
  return { recompute, candidatesCreated };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCING (build step 6) — DefiLlama → protocols + coarse audit markers.

   The step-5 pipeline above only ever RECOMPUTES rows that were already in the
   database. This is the half that ACQUIRES them. lib/sources/defillama.ts owns
   the network and the curation policy and hands back plain records; everything
   below is the write half, and it keeps the same db-as-an-argument rule so the
   CLI and the in-app action drive identical code.

   Two rules run through all of it:

     1. IDEMPOTENT, NEVER DESTRUCTIVE. Unlike db/seed.ts (which truncates), a
        sync upserts on protocols.slug and can be re-run any number of times. A
        protocol that vanishes from DefiLlama is left alone, never deleted —
        you may have private findings filed against it.

     2. THE SYNC OWNS ONLY WHAT IT SOURCED. is_published, archived,
        security_contact and every bounty field are researcher decisions and are
        never written here, so a re-run can never republish or unpublish
        anything. github_repo is fill-if-empty: the feed gives an ORG page, and
        a hand-recorded repo URL is strictly better than that.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Attribution for the coarse audit markers this sync creates. */
export const DEFILLAMA_AUDITOR = "Unknown (DefiLlama)";

const DEFILLAMA_LINK_NOTE =
  "Sourced from DefiLlama. Report link only — auditor, report date and " +
  "reviewed commit unknown, so this audit covers no deployment until verified.";

/**
 * Dedup key for the "the feed says N audits but published no links" marker.
 * A real report URL can never collide with it, so one Set holds both kinds.
 */
export const AUDIT_COUNT_MARKER_KEY = " defillama-count-marker";

/** The columns of `protocols` the DefiLlama sync is allowed to write. */
export interface ProtocolSourceValues {
  slug: string;
  name: string;
  website: string | null;
  twitter: string | null;
  githubRepo: string | null;
  defillamaId: string;
  /** Postgres numeric — carried as a string so no precision is invented. */
  tvlUsd: string | null;
}

/** The subset of an existing row the plan needs in order to diff. */
export interface ExistingProtocol {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  twitter: string | null;
  githubRepo: string | null;
  defillamaId: string | null;
  tvlUsd: string | null;
}

export type ProtocolWriteAction = "insert" | "update" | "unchanged";

export interface ProtocolWritePlan {
  action: ProtocolWriteAction;
  values: ProtocolSourceValues;
}

/** numeric(30,2): a fixed two-decimal string, so re-runs diff by value. */
function toNumericString(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/**
 * Decide what a single sourced record does to the database: create the
 * protocol, patch the fields that actually moved, or nothing at all.
 *
 * Pure, and the whole "the sync owns only what it sourced" policy lives here —
 * which is why it is exported and tested rather than inlined into the loop.
 * Note the two asymmetric rules:
 *   · website/twitter are never nulled out by a feed that dropped them; a
 *     value we already have beats a blank.
 *   · githubRepo is only ever filled in, never replaced — see rule 2 above.
 */
export function planProtocolWrite(
  existing: ExistingProtocol | undefined,
  record: SourcedProtocol,
): ProtocolWritePlan {
  const tvlUsd = toNumericString(record.tvlUsd);

  if (existing === undefined) {
    return {
      action: "insert",
      values: {
        slug: record.slug,
        name: record.name,
        website: record.website,
        twitter: record.twitter,
        githubRepo: record.githubRepo,
        defillamaId: record.defillamaId,
        tvlUsd,
      },
    };
  }

  const values: ProtocolSourceValues = {
    slug: existing.slug,
    name: record.name,
    website: record.website ?? existing.website,
    twitter: record.twitter ?? existing.twitter,
    githubRepo: existing.githubRepo ?? record.githubRepo,
    defillamaId: record.defillamaId,
    tvlUsd,
  };

  const moved =
    values.name !== existing.name ||
    values.website !== existing.website ||
    values.twitter !== existing.twitter ||
    values.githubRepo !== existing.githubRepo ||
    values.defillamaId !== existing.defillamaId ||
    values.tvlUsd !== existing.tvlUsd;

  return { action: moved ? "update" : "unchanged", values };
}

/** One coarse audit row the sync wants to create. */
export interface PlannedAudit {
  auditor: string;
  reportUrl: string | null;
  scopeNote: string;
}

/**
 * The audit rows a sourced record still owes the database, given the dedup
 * keys already present for that protocol.
 *
 * Two cases, because the feed disagrees with itself: `audits: "3"` with an
 * empty `audit_links` is common (Aerodrome Slipstream is one). Creating three
 * anonymous rows would be a fabrication and creating none would file an
 * audited protocol as unaudited, so a single marker row records exactly what
 * the feed said — audited, count N, reports not published.
 *
 * Every row lands with report_date and reviewed_commit NULL and no
 * audit_deployments link, which is what keeps computeDrift honest: a DefiLlama
 * marker can never move a deployment off `unknown` on its own.
 */
export function planAuditRows(
  record: SourcedProtocol,
  existingKeys: ReadonlySet<string>,
): PlannedAudit[] {
  const rows: PlannedAudit[] = [];

  for (const link of record.auditLinks) {
    if (existingKeys.has(link)) continue;
    rows.push({
      auditor: DEFILLAMA_AUDITOR,
      reportUrl: link,
      scopeNote: DEFILLAMA_LINK_NOTE,
    });
  }

  if (
    record.auditLinks.length === 0 &&
    record.auditCount > 0 &&
    !existingKeys.has(AUDIT_COUNT_MARKER_KEY)
  ) {
    rows.push({
      auditor: DEFILLAMA_AUDITOR,
      reportUrl: null,
      scopeNote:
        `DefiLlama reports ${record.auditCount} audit(s) for this protocol but ` +
        "publishes no report links. Presence only — find the reports to verify.",
    });
  }

  return rows;
}

/**
 * The dedup key for one existing audit row. A row with a report URL is keyed by
 * it regardless of who recorded it, so the sync never duplicates a link a human
 * already filed. A row with no URL only counts as the count-marker when the
 * sync itself wrote it — a hand-entered audit with no link is a different
 * assertion and must not suppress the marker.
 */
export function auditDedupKey(reportUrl: string | null, source: string): string | null {
  if (reportUrl !== null) return reportUrl;
  return source === "defillama" ? AUDIT_COUNT_MARKER_KEY : null;
}

export interface SourceSummary {
  /** Curated records handed to the sync. */
  fetched: number;
  protocolsCreated: number;
  protocolsUpdated: number;
  protocolsUnchanged: number;
  auditsCreated: number;
}

/** Neon HTTP has no transactions here; keep each statement a sane size. */
const WRITE_CHUNK = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Upsert curated DefiLlama records into `protocols` and top up their coarse
 * `audits` markers. Safe to re-run; see the section header for what it will and
 * will not touch.
 *
 * Writes go out as chunked `insert … on conflict (slug) do update`, which is
 * one round trip per 200 protocols rather than per protocol — the difference
 * between a sync that finishes and one that times out at ~1,300 records. The
 * per-record decision is still made in JS by planProtocolWrite, so the summary
 * counts are real and unchanged rows are never written at all.
 */
export async function syncFromDefiLlama(
  db: DB,
  records: readonly SourcedProtocol[],
): Promise<SourceSummary> {
  const summary: SourceSummary = {
    fetched: records.length,
    protocolsCreated: 0,
    protocolsUpdated: 0,
    protocolsUnchanged: 0,
    auditsCreated: 0,
  };
  if (records.length === 0) return summary;

  const existingRows = await db
    .select({
      id: schema.protocols.id,
      slug: schema.protocols.slug,
      name: schema.protocols.name,
      website: schema.protocols.website,
      twitter: schema.protocols.twitter,
      githubRepo: schema.protocols.githubRepo,
      defillamaId: schema.protocols.defillamaId,
      tvlUsd: schema.protocols.tvlUsd,
    })
    .from(schema.protocols);

  const existingBySlug = new Map(existingRows.map((r) => [r.slug, r]));

  const toWrite: ProtocolSourceValues[] = [];
  for (const record of records) {
    const plan = planProtocolWrite(existingBySlug.get(record.slug), record);
    if (plan.action === "unchanged") {
      summary.protocolsUnchanged += 1;
      continue;
    }
    if (plan.action === "insert") summary.protocolsCreated += 1;
    else summary.protocolsUpdated += 1;
    toWrite.push(plan.values);
  }

  for (const batch of chunk(toWrite, WRITE_CHUNK)) {
    await db
      .insert(schema.protocols)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.protocols.slug,
        // Only the sourced columns. is_published, archived, security_contact
        // and the bounty fields are deliberately absent.
        set: {
          name: sql`excluded.name`,
          website: sql`excluded.website`,
          twitter: sql`excluded.twitter`,
          githubRepo: sql`excluded.github_repo`,
          defillamaId: sql`excluded.defillama_id`,
          tvlUsd: sql`excluded.tvl_usd`,
        },
      });
  }

  summary.auditsCreated = await syncDefiLlamaAudits(db, records);
  return summary;
}

/**
 * Create the audit markers the sourced records still owe. Split out so the
 * id lookup happens after the protocol upsert — newly inserted protocols have
 * no id until then.
 */
async function syncDefiLlamaAudits(
  db: DB,
  records: readonly SourcedProtocol[],
): Promise<number> {
  const idBySlug = new Map(
    (
      await db
        .select({ id: schema.protocols.id, slug: schema.protocols.slug })
        .from(schema.protocols)
    ).map((r) => [r.slug, r.id]),
  );

  const auditRows = await db
    .select({
      protocolId: schema.audits.protocolId,
      reportUrl: schema.audits.reportUrl,
      source: schema.audits.source,
    })
    .from(schema.audits);

  const keysByProtocol = new Map<number, Set<string>>();
  for (const row of auditRows) {
    const key = auditDedupKey(row.reportUrl, row.source);
    if (key === null) continue;
    const set = keysByProtocol.get(row.protocolId) ?? new Set<string>();
    set.add(key);
    keysByProtocol.set(row.protocolId, set);
  }

  const toInsert: (typeof schema.audits.$inferInsert)[] = [];
  for (const record of records) {
    const protocolId = idBySlug.get(record.slug);
    if (protocolId === undefined) continue; // upsert failed for this slug
    const keys = keysByProtocol.get(protocolId) ?? new Set<string>();

    for (const planned of planAuditRows(record, keys)) {
      toInsert.push({
        protocolId,
        auditor: planned.auditor,
        reportUrl: planned.reportUrl,
        reportDate: null,
        reviewedCommit: null,
        scopeNote: planned.scopeNote,
        source: "defillama",
        verifiedByMe: false,
      });
      // Guard against a feed row that repeats a link across two records.
      keys.add(planned.reportUrl ?? AUDIT_COUNT_MARKER_KEY);
      keysByProtocol.set(protocolId, keys);
    }
  }

  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    await db.insert(schema.audits).values(batch);
  }

  return toInsert.length;
}
