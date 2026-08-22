import { and, eq, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import type { DiscoveredReport } from "@/lib/sources/github";
import {
  isSupportedChain,
  normalizeAddress,
  type ResolvedDeployment,
  type ResolvedUpgrade,
} from "@/lib/sources/explorer";

/**
 * ON-CHAIN + AUDIT-REPORT INGEST (build step 7) — the write half.
 *
 * Split out of lib/ingest.ts rather than appended to it: that file already
 * carries the step-5 recompute pipeline and the step-6 DefiLlama sync, and a
 * third section would make it the place everything goes. Same rules apply here
 * and they are the rules that make all three drivable from a CLI, a server
 * action and a test:
 *
 *   · takes `db` as an argument and imports no client
 *   · every decision that is not a database round trip is a pure exported
 *     function with a test
 *   · idempotent and never destructive — re-running writes nothing new
 *
 * ── What this module writes, and what it refuses to ───────────────────────
 *
 * WRITES (facts, from a source that actually knows them):
 *   deployments.deployed_at, last_upgraded_at, is_upgradeable,
 *   upgrade_authority, source_verified, explorer_url, label
 *   upgrade_events rows, one per Upgraded(address) log
 *   audits rows with auditor + report_url + report_date parsed from a repo
 *
 * REFUSES (assertions no source can make):
 *   deployments.deployed_commit — an explorer has bytecode, never a commit
 *   audits.reviewed_commit      — a filename is not a review scope
 *   audit_deployments links     — "this audit covers this contract" is the
 *                                 single claim the whole public verdict rests
 *                                 on, and it is a human's to make
 *
 * The refused three are exactly the inputs computeDrift needs to leave
 * `unknown`. That is not an oversight in step 7; it is step 7's design. This
 * module gets a target from "nothing recorded" to "everything recorded except
 * the two commits", and the workspace gives the researcher one form each for
 * them (`recordDeployedCommit`, `recordReviewedCommit`) plus the link action,
 * each of which stamps the assertion as theirs. See CLAUDE.md, step 1: drift is
 * four discrete states and we never guess our way into one.
 */

type DB = NeonHttpDatabase<typeof schema>;

/** Neon HTTP has no transactions here; keep each statement a sane size. */
const WRITE_CHUNK = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pinning a contract
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PinDeploymentInput {
  protocolId: number;
  chain: string;
  addressOrProgramId: string;
  label?: string | null;
}

export interface PinResult {
  deploymentId: number;
  created: boolean;
}

/**
 * Record a contract against a protocol — the act that graduates a step-6
 * sourced protocol out of the "not yet pinned" table and into the real queue.
 *
 * EVM addresses are normalised to lowercase; anything else (a Solana program
 * id, a Stacks principal) is stored as typed, because those are case-sensitive
 * and lowercasing one would break it. That asymmetry is the reason this is a
 * function and not an inline insert.
 *
 * Idempotent by the unique index on (protocol_id, chain, lower(address)):
 * pinning the same contract twice returns the existing row rather than
 * erroring, so a CLI sweep and an impatient second click agree.
 */
export async function pinDeployment(
  db: DB,
  input: PinDeploymentInput,
): Promise<PinResult> {
  const address = isSupportedChain(input.chain)
    ? normalizeAddress(input.addressOrProgramId)
    : input.addressOrProgramId.trim();

  if (address.length === 0) {
    throw new Error("A contract address or program id is required.");
  }

  const [existing] = await db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.protocolId, input.protocolId),
        eq(schema.deployments.chain, input.chain as (typeof schema.deployments.chain.enumValues)[number]),
        sql`lower(${schema.deployments.addressOrProgramId}) = lower(${address})`,
      ),
    )
    .limit(1);

  if (existing) return { deploymentId: existing.id, created: false };

  const [created] = await db
    .insert(schema.deployments)
    .values({
      protocolId: input.protocolId,
      chain: input.chain as (typeof schema.deployments.chain.enumValues)[number],
      addressOrProgramId: address,
      label: input.label ?? null,
    })
    .returning({ id: schema.deployments.id });

  if (!created) throw new Error("Failed to pin the deployment.");
  return { deploymentId: created.id, created: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Applying an explorer result
   ═══════════════════════════════════════════════════════════════════════════ */

/** The `deployments` columns an explorer resolve is allowed to write. */
export interface DeploymentOnChainValues {
  label: string | null;
  isUpgradeable: boolean;
  upgradeAuthority: string | null;
  deployedAt: Date | null;
  lastUpgradedAt: Date | null;
  sourceVerified: boolean;
  explorerUrl: string | null;
}

/** The subset of an existing row the planner needs in order to diff. */
export interface ExistingDeployment {
  label: string | null;
  isUpgradeable: boolean;
  upgradeAuthority: string | null;
  deployedAt: Date | null;
  lastUpgradedAt: Date | null;
  sourceVerified: boolean;
  explorerUrl: string | null;
}

export interface DeploymentWritePlan {
  changed: boolean;
  values: DeploymentOnChainValues;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * What an explorer result does to an existing deployment row.
 *
 * Pure, exported and tested because this is where step 7's ownership policy
 * lives — the counterpart to `planProtocolWrite` in lib/ingest.ts. Three rules,
 * all of them about not destroying what a human recorded:
 *
 *   · A null from the explorer NEVER overwrites a recorded value. Null means
 *     "not established" (an unverified contract, an explorer with no creation
 *     index), which is weaker than a researcher's hand-entered date, not newer.
 *
 *   · `is_upgradeable` and `source_verified` are booleans and CAN move in both
 *     directions, because a false from a completed probe is a real finding:
 *     these are the two things the explorer genuinely knows better than we do.
 *
 *   · `label` is fill-if-empty. The explorer offers a contract name; a
 *     researcher's "v3 Pool (main)" beats `TransparentUpgradeableProxy` every
 *     time, so a recorded label is never replaced. Same rule step 6 used for
 *     github_repo, for the same reason.
 *
 * `deployed_commit` is absent from the value type entirely. It is not that the
 * planner declines to write it — there is nowhere for it to be written from.
 */
export function planDeploymentWrite(
  existing: ExistingDeployment,
  resolved: ResolvedDeployment,
): DeploymentWritePlan {
  const values: DeploymentOnChainValues = {
    label: existing.label ?? resolved.contractName,
    isUpgradeable: resolved.isUpgradeable,
    upgradeAuthority: resolved.upgradeAuthority ?? existing.upgradeAuthority,
    deployedAt: resolved.deployedAt ?? existing.deployedAt,
    lastUpgradedAt: resolved.lastUpgradedAt ?? existing.lastUpgradedAt,
    sourceVerified: resolved.sourceVerified,
    explorerUrl: resolved.explorerUrl ?? existing.explorerUrl,
  };

  const changed =
    values.label !== existing.label ||
    values.isUpgradeable !== existing.isUpgradeable ||
    values.upgradeAuthority !== existing.upgradeAuthority ||
    !sameInstant(values.deployedAt, existing.deployedAt) ||
    !sameInstant(values.lastUpgradedAt, existing.lastUpgradedAt) ||
    values.sourceVerified !== existing.sourceVerified ||
    values.explorerUrl !== existing.explorerUrl;

  return { changed, values };
}

/**
 * The dedup key for one upgrade event.
 *
 * A transaction hash identifies an upgrade exactly, so it is the key when there
 * is one. When there is not — a log the explorer returned without a hash — the
 * timestamp stands in: two upgrades of the same proxy in the same second is not
 * a thing that happens, and treating them as one is far better than writing the
 * same upgrade again on every sweep.
 */
export function upgradeDedupKey(txHash: string | null, occurredAt: Date): string {
  return txHash !== null ? txHash.toLowerCase() : `t:${occurredAt.getTime()}`;
}

/**
 * The upgrade events a resolve still owes the database, given what is recorded.
 * Pure, so "a re-run writes nothing" is a property with a test rather than a
 * hope. `maxEvents` keeps the newest N: a router that upgrades weekly has
 * hundreds of logs, only the recent ones inform a review, and last_upgraded_at
 * was already computed from the complete list before this cap applies.
 */
export function planUpgradeRows(
  upgrades: readonly ResolvedUpgrade[],
  existingKeys: ReadonlySet<string>,
  maxEvents: number,
): ResolvedUpgrade[] {
  const fresh = upgrades.filter(
    (u) => !existingKeys.has(upgradeDedupKey(u.txHash, u.occurredAt)),
  );
  if (maxEvents <= 0 || fresh.length <= maxEvents) return fresh;
  return fresh.slice(fresh.length - maxEvents);
}

export interface ApplyResolveSummary {
  deploymentId: number;
  deploymentChanged: boolean;
  upgradeEventsCreated: number;
  warnings: string[];
}

/**
 * Write one resolved deployment: patch the row, append any upgrade events that
 * are not already recorded. Does not recompute drift — the caller runs
 * `runIngest` once at the end of a sweep rather than once per address.
 */
export async function applyResolvedDeployment(
  db: DB,
  deploymentId: number,
  resolved: ResolvedDeployment,
  maxEvents: number,
): Promise<ApplyResolveSummary> {
  const [existing] = await db
    .select({
      label: schema.deployments.label,
      isUpgradeable: schema.deployments.isUpgradeable,
      upgradeAuthority: schema.deployments.upgradeAuthority,
      deployedAt: schema.deployments.deployedAt,
      lastUpgradedAt: schema.deployments.lastUpgradedAt,
      sourceVerified: schema.deployments.sourceVerified,
      explorerUrl: schema.deployments.explorerUrl,
    })
    .from(schema.deployments)
    .where(eq(schema.deployments.id, deploymentId))
    .limit(1);

  if (!existing) {
    throw new Error(`Deployment ${deploymentId} not found.`);
  }

  const plan = planDeploymentWrite(existing, resolved);
  if (plan.changed) {
    await db
      .update(schema.deployments)
      .set(plan.values)
      .where(eq(schema.deployments.id, deploymentId));
  }

  const recorded = await db
    .select({
      txHash: schema.upgradeEvents.txHash,
      occurredAt: schema.upgradeEvents.occurredAt,
    })
    .from(schema.upgradeEvents)
    .where(eq(schema.upgradeEvents.deploymentId, deploymentId));

  const existingKeys = new Set(
    recorded.map((r) => upgradeDedupKey(r.txHash, r.occurredAt)),
  );

  const toInsert = planUpgradeRows(resolved.upgrades, existingKeys, maxEvents);
  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    await db.insert(schema.upgradeEvents).values(
      batch.map((u) => ({
        deploymentId,
        occurredAt: u.occurredAt,
        txHash: u.txHash,
        newImplementation: u.newImplementation,
        blockNumber: u.blockNumber,
      })),
    );
  }

  return {
    deploymentId,
    deploymentChanged: plan.changed,
    upgradeEventsCreated: toInsert.length,
    warnings: resolved.warnings,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Applying discovered audit reports
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Attribution when a filename names no firm. Deliberately parallel to step 6's
 * "Unknown (DefiLlama)" and deliberately not a guess: `audits.auditor` is NOT
 * NULL, and putting a plausible-looking firm name on a report they may not have
 * written is a libel risk as much as a data-quality one.
 */
export const GITHUB_AUDITOR_UNKNOWN = "Unknown (GitHub)";

/**
 * The note that carries what discovery found but will not assert.
 *
 * The candidate commit lives here, in prose, where it is unmistakably a lead
 * rather than a value. `audits.reviewed_commit` stays NULL until a human moves
 * it across — which is what `recordReviewedCommit` in the workspace does, and
 * why it also sets `verified_by_me`.
 */
export function buildScopeNote(report: DiscoveredReport, folder: string): string {
  const parts = [`Discovered in ${folder}/ on GitHub (${report.path}).`];

  if (report.reportDate === null) {
    parts.push("The filename states no report date, so report_date is null.");
    if (report.candidateCommitDate !== null) {
      parts.push(
        `The file landed in the repo on ${report.candidateCommitDate
          .toISOString()
          .slice(0, 10)} — a candidate date, not a recorded one.`,
      );
    }
  }

  if (report.candidateCommit !== null) {
    parts.push(
      `CANDIDATE reviewed commit ${report.candidateCommit.slice(0, 12)} ` +
        "(the commit that last touched this report file). Not written to " +
        "reviewed_commit: a report lands days or weeks after the review it " +
        "describes. Open the report, confirm the scope commit, then record it.",
    );
  } else {
    parts.push("No candidate commit resolved.");
  }

  return parts.join(" ");
}

/** One audit row discovery wants to create. */
export interface PlannedDiscoveredAudit {
  auditor: string;
  reportUrl: string;
  reportDate: Date | null;
  scopeNote: string;
}

/**
 * The audit rows a discovery result still owes, given the report URLs already
 * on record for that protocol.
 *
 * Dedup is by report URL, the same key step 6 uses, so a DefiLlama marker and a
 * GitHub discovery pointing at the same PDF do not become two rows. Step 6's
 * markers usually point at the protocol's own docs site while discovery points
 * at the repo blob, so both commonly survive — that is correct, they are two
 * different records of the same review and the researcher merges them by hand.
 */
export function planDiscoveredAudits(
  reports: readonly DiscoveredReport[],
  folder: string,
  existingUrls: ReadonlySet<string>,
): PlannedDiscoveredAudit[] {
  const rows: PlannedDiscoveredAudit[] = [];
  const seen = new Set(existingUrls);

  for (const report of reports) {
    if (seen.has(report.reportUrl)) continue;
    seen.add(report.reportUrl);
    rows.push({
      auditor: report.auditor ?? GITHUB_AUDITOR_UNKNOWN,
      reportUrl: report.reportUrl,
      reportDate: report.reportDate,
      scopeNote: buildScopeNote(report, folder),
    });
  }

  return rows;
}

export interface DiscoverySummary {
  protocolId: number;
  auditsCreated: number;
  reportsFound: number;
  warnings: string[];
}

/**
 * Write the audit rows one discovery result owes. `source = 'github'` (an enum
 * member that has existed since step 1) marks their provenance, and
 * `verified_by_me` stays false: nobody has opened the PDF yet.
 */
export async function applyDiscoveredReports(
  db: DB,
  protocolId: number,
  reports: readonly DiscoveredReport[],
  folder: string | null,
  warnings: readonly string[],
): Promise<DiscoverySummary> {
  if (reports.length === 0 || folder === null) {
    return {
      protocolId,
      auditsCreated: 0,
      reportsFound: reports.length,
      warnings: [...warnings],
    };
  }

  const recorded = await db
    .select({ reportUrl: schema.audits.reportUrl })
    .from(schema.audits)
    .where(eq(schema.audits.protocolId, protocolId));

  const existingUrls = new Set(
    recorded
      .map((r) => r.reportUrl)
      .filter((url): url is string => url !== null),
  );

  const planned = planDiscoveredAudits(reports, folder, existingUrls);

  for (const batch of chunk(planned, WRITE_CHUNK)) {
    await db.insert(schema.audits).values(
      batch.map((row) => ({
        protocolId,
        auditor: row.auditor,
        reportUrl: row.reportUrl,
        reportDate: row.reportDate,
        // Never written by discovery. See the module header.
        reviewedCommit: null,
        scopeNote: row.scopeNote,
        source: "github" as const,
        verifiedByMe: false,
      })),
    );
  }

  return {
    protocolId,
    auditsCreated: planned.length,
    reportsFound: reports.length,
    warnings: [...warnings],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   The two human assertions
   ═══════════════════════════════════════════════════════════════════════════ */

/** A commit sha, full or abbreviated, as git itself accepts. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

/**
 * Record the commit currently deployed at an address.
 *
 * The researcher's assertion, and the last thing computeDrift is missing.
 * Nothing automated writes this column — see the module header for why. Passing
 * null clears it, which puts the deployment back to `unknown` on the next
 * recompute; retracting a claim has to be as easy as making one.
 */
export async function recordDeployedCommit(
  db: DB,
  deploymentId: number,
  commit: string | null,
): Promise<void> {
  if (commit !== null && !isCommitSha(commit)) {
    throw new Error(`"${commit}" is not a commit sha.`);
  }
  await db
    .update(schema.deployments)
    .set({ deployedCommit: commit === null ? null : commit.trim().toLowerCase() })
    .where(eq(schema.deployments.id, deploymentId));
}

/**
 * Record the commit an audit reviewed, and mark the row verified.
 *
 * `verified_by_me` flips to true because setting this is exactly the act of
 * verification: somebody opened the report and read the scope section. The two
 * writes belong together and are deliberately not separable in the UI.
 */
export async function recordReviewedCommit(
  db: DB,
  auditId: number,
  commit: string | null,
  reportDate: Date | null,
): Promise<void> {
  if (commit !== null && !isCommitSha(commit)) {
    throw new Error(`"${commit}" is not a commit sha.`);
  }
  await db
    .update(schema.audits)
    .set({
      reviewedCommit: commit === null ? null : commit.trim().toLowerCase(),
      // Only ever set, never cleared: a run that could not parse a date must
      // not wipe one a researcher read off the report's cover page.
      ...(reportDate !== null ? { reportDate } : {}),
      verifiedByMe: commit !== null,
    })
    .where(eq(schema.audits.id, auditId));
}

/**
 * Link or unlink an audit and a deployment.
 *
 * This join row IS the ancestry assertion — CLAUDE.md, step 5: "recomputeDrift
 * trusts the audit_deployments link as recorded ancestry". Creating one says
 * "the commit this audit reviewed is an ancestor of what is deployed here", and
 * that is the single claim the public coverage verdict rests on. It is made by
 * a person, from the workspace, and nothing in step 7 makes it automatically.
 */
export async function setAuditCoverage(
  db: DB,
  auditId: number,
  deploymentId: number,
  covered: boolean,
): Promise<void> {
  if (covered) {
    await db
      .insert(schema.auditDeployments)
      .values({ auditId, deploymentId })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(schema.auditDeployments)
    .where(
      and(
        eq(schema.auditDeployments.auditId, auditId),
        eq(schema.auditDeployments.deploymentId, deploymentId),
      ),
    );
}
