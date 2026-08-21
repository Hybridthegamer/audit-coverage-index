/**
 * Drift computation — the single source of truth for a deployment's coverage
 * state and drift in days. Pure and deterministic: no DB, no filesystem, no
 * `git`, no `Date.now()` unless injected. Both the ingest worker (build step 5)
 * and any manual recompute call this; the values it returns are cached into
 * deployments.coverage_state / drift_days.
 *
 * The covering-audit rule from the SPEC is:
 *
 *   covering_audit = most recent audit whose reviewed_commit is an ancestor
 *                    of deployments.deployed_commit
 *   drift_days     = last_upgraded_at - covering_audit.report_date
 *
 * Git ancestry (`reviewed_commit` ⊆ `deployed_commit`) cannot be decided by a
 * pure function, so the caller resolves it upstream (git merge-base in the
 * worker) and passes the boolean in as `isAncestorOfDeployed`. That keeps this
 * function testable and keeps the expensive git work off the query path.
 */

export type CoverageState = "current" | "drifted" | "uncovered" | "unknown";

export interface CandidateAudit {
  /** Commit the auditor reviewed. Null => ancestry can't be established. */
  reviewedCommit: string | null;
  /** Report date off the cover page. Null => 'unknown' (a wrong date poisons
   *  every downstream public number, so we never guess). */
  reportDate: Date | null;
  /** Whether reviewedCommit is an ancestor of the deployment's deployedCommit.
   *  Decided upstream via git; only meaningful when both commits are known. */
  isAncestorOfDeployed: boolean;
}

export interface DriftInput {
  /** Commit currently deployed on-chain. Null => 'unknown'. */
  deployedCommit: string | null;
  /** Most recent on-chain upgrade. Null with a covering audit => 'current'. */
  lastUpgradedAt: Date | null;
  /** Original on-chain deployment date. Fallback origin for 'uncovered'. */
  deployedAt: Date | null;
  /** Every audit associated with this deployment (via the join table). */
  candidateAudits: CandidateAudit[];
  /** Injected clock for deterministic tests; defaults to now. */
  now?: Date;
}

export interface DriftResult {
  coverageState: CoverageState;
  /** Whole days, floored, never negative. Null when it can't be measured. */
  driftDays: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two instants, floored at zero. */
function daysBetween(from: Date, to: Date): number {
  const diff = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
  return diff < 0 ? 0 : diff;
}

export function computeDrift(input: DriftInput): DriftResult {
  const { deployedCommit, lastUpgradedAt, deployedAt, candidateAudits } = input;
  const now = input.now ?? new Date();

  // --- unknown: missing commit data on the deployment side.
  if (!deployedCommit) {
    return { coverageState: "unknown", driftDays: null };
  }

  // Audits that plausibly cover this deployment: reviewed_commit is an
  // ancestor of what's deployed. Ancestry was decided upstream.
  const ancestorAudits = candidateAudits.filter((a) => a.isAncestorOfDeployed);

  // --- unknown: an ancestor audit exists but we can't evaluate it because a
  // commit or the report date is missing on the audit side. Distinct from
  // "no audit at all" — we say so plainly rather than calling it uncovered.
  const hasUnevaluableAncestor = ancestorAudits.some(
    (a) => a.reviewedCommit === null || a.reportDate === null,
  );
  if (hasUnevaluableAncestor) {
    return { coverageState: "unknown", driftDays: null };
  }

  // --- uncovered: no audit covers the deployed commit at all.
  if (ancestorAudits.length === 0) {
    // Drift measured from the deployment date when we have it.
    const from = deployedAt;
    return {
      coverageState: "uncovered",
      driftDays: from ? daysBetween(from, now) : null,
    };
  }

  // covering_audit = most recent (by report_date) ancestor audit.
  // reportDate is guaranteed non-null here by the unknown check above.
  const coveringAudit = ancestorAudits.reduce((latest, a) =>
    (a.reportDate as Date).getTime() > (latest.reportDate as Date).getTime()
      ? a
      : latest,
  );
  const reportDate = coveringAudit.reportDate as Date;

  // --- current: no upgrade since the covering audit.
  if (!lastUpgradedAt || lastUpgradedAt.getTime() <= reportDate.getTime()) {
    return { coverageState: "current", driftDays: 0 };
  }

  // --- drifted: code changed after the covering audit.
  return {
    coverageState: "drifted",
    driftDays: daysBetween(reportDate, lastUpgradedAt),
  };
}
