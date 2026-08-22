import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { computeDrift, type CandidateAudit, type CoverageState } from "@/lib/drift";

/**
 * Ingest modules (build step 5). The recompute pipeline that turns raw
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
