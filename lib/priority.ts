import type { CoverageState } from "@/lib/drift";

/**
 * priority_score — the private research-queue ranking.
 *
 * This is the "priority_score" CLAUDE.md permits: a query-time computation, NOT
 * a stored column, and NOT the public coverage metric. It never leaves the
 * authenticated workspace and is never written to the database. Coverage is
 * still the four discrete states from drift.ts; this is a separate heuristic
 * that orders targets for manual review. Keeping it here (pure + tested), the
 * way drift.ts is, is what satisfies the "explicit written formula" rule.
 *
 * The formula, written down:
 *
 *   score = stateBase + tvlComponent + driftComponent + bountyBonus + upgradeableBonus
 *
 *   stateBase          uncovered 50 · drifted 30 · unknown 12 · current 0
 *                      (unreviewed-and-live code is the point of the workspace)
 *   tvlComponent       0..30, log10-scaled from $1K (0) to $1B+ (30)
 *                      (money at risk, compressed so a whale can't dominate)
 *   driftComponent     0..20, driftDays/365 capped at one year
 *                      (the longer unreviewed code has been live, the hotter)
 *   bountyBonus        +8 when the protocol runs a bug bounty
 *                      (a live program is a disclosure path and a payout)
 *   upgradeableBonus   +5 when the deployment is upgradeable
 *                      (mutable code keeps drifting; worth watching)
 *
 * Range is 0..113. It is an ordering, not a percentage — never render it as one.
 */

export interface PriorityInput {
  coverageState: CoverageState;
  tvlUsd: number | null;
  driftDays: number | null;
  hasBounty: boolean;
  isUpgradeable: boolean;
}

const STATE_BASE: Record<CoverageState, number> = {
  uncovered: 50,
  drifted: 30,
  unknown: 12,
  current: 0,
};

const TVL_MAX_POINTS = 30;
const DRIFT_MAX_POINTS = 20;
const BOUNTY_BONUS = 8;
const UPGRADEABLE_BONUS = 5;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** $1K → 0, $1B → full marks. Log-scaled so a whale can't swamp the ranking. */
function tvlComponent(tvlUsd: number | null): number {
  if (tvlUsd === null || tvlUsd <= 1_000) return 0;
  const fraction = clamp01((Math.log10(tvlUsd) - 3) / 6); // 1e3..1e9
  return fraction * TVL_MAX_POINTS;
}

/** 0 days → 0, ≥365 days → full marks. */
function driftComponent(driftDays: number | null): number {
  if (driftDays === null || driftDays <= 0) return 0;
  return clamp01(driftDays / 365) * DRIFT_MAX_POINTS;
}

export function computePriority(input: PriorityInput): number {
  const score =
    STATE_BASE[input.coverageState] +
    tvlComponent(input.tvlUsd) +
    driftComponent(input.driftDays) +
    (input.hasBounty ? BOUNTY_BONUS : 0) +
    (input.isUpgradeable ? UPGRADEABLE_BONUS : 0);

  return Math.round(score);
}

/* ------------------------------------------------------------------ *
 * Protocol-level priority (build step 6)
 * ------------------------------------------------------------------ */

/**
 * Whether a protocol has any audit on record at all. The curation-layer
 * signal DefiLlama can actually answer — as opposed to coverage_state, which
 * asks the much harder commit-level question and needs step 7's on-chain data.
 */
export type AuditStatus = "audited" | "unaudited";

export interface ProtocolPriorityInput {
  auditStatus: AuditStatus;
  tvlUsd: number | null;
  hasBounty: boolean;
}

/**
 * protocol_priority — the ranking for sourced protocols that have no
 * deployments pinned yet.
 *
 * A separate formula from computePriority above, because a bare protocol has
 * none of that function's inputs: no coverage_state (nothing deployed is
 * recorded), no drift days, no upgradeability. Ranking it through the
 * deployment formula would mean feeding it `unknown` and nulls and getting a
 * flat 12 + TVL for every row — an ordering that says nothing. So:
 *
 *   score = auditBase + tvlComponent + bountyBonus
 *
 *   auditBase        unaudited 40 · audited 10
 *                    (an unaudited protocol holding real money is the single
 *                     strongest signal this data source can produce)
 *   tvlComponent     0..30, the same log10 curve computePriority uses, so the
 *                    two rankings weigh money identically
 *   bountyBonus      +8 when the protocol runs a bug bounty (a disclosure path
 *                    and a payout), same weight as the deployment formula
 *
 * Range is 0..78. Like priority_score it is computed at query time, never
 * stored, never public, and it is an ordering rather than a percentage.
 */
const AUDIT_BASE: Record<AuditStatus, number> = {
  unaudited: 40,
  audited: 10,
};

export function computeProtocolPriority(input: ProtocolPriorityInput): number {
  const score =
    AUDIT_BASE[input.auditStatus] +
    tvlComponent(input.tvlUsd) +
    (input.hasBounty ? BOUNTY_BONUS : 0);

  return Math.round(score);
}
