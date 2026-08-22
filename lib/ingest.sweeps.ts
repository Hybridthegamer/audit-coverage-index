import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import {
  applyDiscoveredReports,
  applyResolvedDeployment,
  type ApplyResolveSummary,
  type DiscoverySummary,
} from "@/lib/ingest.onchain";
import {
  isSupportedChain,
  resolveDeployment,
  SUPPORTED_CHAINS,
  type ExplorerOptions,
} from "@/lib/sources/explorer";
import { discoverAuditReports, type GithubOptions } from "@/lib/sources/github";

/**
 * Step-7 SWEEPS — the batch drivers over the two step-7 sources.
 *
 * lib/ingest.onchain.ts writes ONE resolved deployment or ONE protocol's
 * discovered reports. This file is the loop: pick the rows that most need the
 * work, call the source, write the result, keep going when one of them fails.
 *
 * The split matters because the failure policy lives here. A sweep over nine
 * hundred protocols will hit an unverified contract, a rate limit, a repo that
 * 404s and a chain nobody supports, and none of those may abort the run — every
 * one is caught, counted and reported. Each item is independent, so a sweep that
 * gets halfway is worth exactly half a sweep, and re-running picks up the rest.
 *
 * Same rules as everything else in the ingest path: `db` is an argument, no
 * client is imported, and nothing here calls revalidatePath (the CLI has no
 * request context — the in-app action is what invalidates the cache, exactly as
 * `db:ingest` vs `runIngestAction` split in step 5 and `db:source` vs
 * `syncDefiLlamaAction` in step 6).
 */

type DB = NeonHttpDatabase<typeof schema>;

/* ═══════════════════════════════════════════════════════════════════════════
   Explorer sweep
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResolveSweepOptions {
  explorer: ExplorerOptions;
  /** Cap on `upgrade_events` written per deployment. */
  maxUpgrades: number;
  /** How many deployments to touch. */
  limit: number;
  /**
   * Re-resolve deployments that already carry explorer data. Off by default: a
   * sweep is for the backlog of never-resolved pins, and re-reading nine
   * hundred contracts to learn nothing is how you lose an API key.
   */
  refresh?: boolean;
  /** Restrict to one protocol — what the per-protocol button uses. */
  protocolId?: number;
}

export interface ResolveSweepSummary {
  attempted: number;
  resolved: number;
  deploymentsChanged: number;
  upgradeEventsCreated: number;
  /** Non-EVM pins, which no explorer can resolve. Reported, never silent. */
  skippedUnsupported: number;
  failures: { deploymentId: number; message: string }[];
  warnings: string[];
}

/**
 * Resolve pinned deployments against their block explorer.
 *
 * Selection order is "never resolved first, then oldest checked": a pin with no
 * `last_checked_at` has nothing at all recorded and is worth strictly more than
 * refreshing one resolved last Tuesday.
 */
export async function resolveDeploymentsOnChain(
  db: DB,
  options: ResolveSweepOptions,
): Promise<ResolveSweepSummary> {
  const summary: ResolveSweepSummary = {
    attempted: 0,
    resolved: 0,
    deploymentsChanged: 0,
    upgradeEventsCreated: 0,
    skippedUnsupported: 0,
    failures: [],
    warnings: [],
  };

  const filters = [eq(schema.protocols.archived, false)];
  if (options.protocolId !== undefined) {
    filters.push(eq(schema.deployments.protocolId, options.protocolId));
  }
  if (options.refresh !== true) {
    // Never-resolved pins only: explorer_url is written by every successful
    // resolve, so its absence is the cheapest "this has never been looked at".
    filters.push(isNull(schema.deployments.explorerUrl));
  }

  const candidates = await db
    .select({
      id: schema.deployments.id,
      chain: schema.deployments.chain,
      address: schema.deployments.addressOrProgramId,
    })
    .from(schema.deployments)
    .innerJoin(schema.protocols, eq(schema.deployments.protocolId, schema.protocols.id))
    .where(and(...filters))
    .orderBy(
      asc(sql`${schema.deployments.lastCheckedAt} nulls first`),
      desc(schema.protocols.tvlUsd),
    )
    .limit(Math.max(1, options.limit));

  for (const candidate of candidates) {
    if (!isSupportedChain(candidate.chain)) {
      summary.skippedUnsupported += 1;
      continue;
    }
    summary.attempted += 1;

    try {
      const resolved = await resolveDeployment(
        candidate.chain,
        candidate.address,
        options.explorer,
      );
      const applied: ApplyResolveSummary = await applyResolvedDeployment(
        db,
        candidate.id,
        resolved,
        options.maxUpgrades,
      );

      summary.resolved += 1;
      if (applied.deploymentChanged) summary.deploymentsChanged += 1;
      summary.upgradeEventsCreated += applied.upgradeEventsCreated;
      for (const warning of applied.warnings) {
        summary.warnings.push(`#${candidate.id}: ${warning}`);
      }
    } catch (error) {
      // One bad address must not cost the other eight hundred.
      summary.failures.push({
        deploymentId: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (summary.skippedUnsupported > 0) {
    summary.warnings.push(
      `${summary.skippedUnsupported} pin(s) are on chains with no block-explorer ` +
        `support (supported: ${SUPPORTED_CHAINS.join(", ")}); resolve those by hand.`,
    );
  }

  return summary;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Audit-discovery sweep
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DiscoverySweepOptions {
  github: GithubOptions;
  limit: number;
  /** Restrict to one protocol — what the per-protocol button uses. */
  protocolId?: number;
  /**
   * Re-visit protocols that already have a GitHub-sourced audit row. Off by
   * default for the same reason `refresh` is on the explorer sweep.
   */
  refresh?: boolean;
}

export interface DiscoverySweepSummary {
  attempted: number;
  protocolsWithReports: number;
  auditsCreated: number;
  failures: { protocolId: number; message: string }[];
  warnings: string[];
}

/**
 * Walk protocols' repos for audit reports.
 *
 * Ranked by TVL descending, because a discovery run is rate-limited (sixty
 * calls an hour without a token) and the biggest unaudited protocol is the one
 * worth spending the budget on. Protocols with no `github_repo` at all are
 * excluded in SQL rather than attempted and failed — there is nothing to look
 * up, and it would burn a slot in the limit.
 */
export async function discoverAuditsForProtocols(
  db: DB,
  options: DiscoverySweepOptions,
): Promise<DiscoverySweepSummary> {
  const summary: DiscoverySweepSummary = {
    attempted: 0,
    protocolsWithReports: 0,
    auditsCreated: 0,
    failures: [],
    warnings: [],
  };

  const filters = [
    eq(schema.protocols.archived, false),
    sql`${schema.protocols.githubRepo} is not null`,
  ];
  if (options.protocolId !== undefined) {
    filters.push(eq(schema.protocols.id, options.protocolId));
  }
  if (options.refresh !== true) {
    filters.push(sql`not exists (
      select 1 from ${schema.audits}
      where ${schema.audits.protocolId} = ${schema.protocols.id}
        and ${schema.audits.source} = 'github'
    )`);
  }

  const candidates = await db
    .select({
      id: schema.protocols.id,
      githubRepo: schema.protocols.githubRepo,
    })
    .from(schema.protocols)
    .where(and(...filters))
    .orderBy(desc(schema.protocols.tvlUsd))
    .limit(Math.max(1, options.limit));

  for (const candidate of candidates) {
    summary.attempted += 1;
    try {
      const result = await discoverAuditReports(candidate.githubRepo, options.github);
      const applied: DiscoverySummary = await applyDiscoveredReports(
        db,
        candidate.id,
        result.reports,
        result.folder,
        result.warnings,
      );

      if (applied.reportsFound > 0) summary.protocolsWithReports += 1;
      summary.auditsCreated += applied.auditsCreated;
      for (const warning of applied.warnings) {
        // "no audits folder found" is the majority outcome and is not news.
        if (warning === "no audits folder found") continue;
        summary.warnings.push(`protocol ${candidate.id}: ${warning}`);
      }
    } catch (error) {
      summary.failures.push({
        protocolId: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
