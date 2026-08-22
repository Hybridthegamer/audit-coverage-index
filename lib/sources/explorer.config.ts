import type { EnvBag } from "@/lib/sources/defillama.config";

/**
 * Block-explorer config (build step 7).
 *
 * Same shape as lib/sources/defillama.config.ts and for the same reason: the
 * knobs are policy, they live in the environment, and the parser is pure — it
 * takes the env bag as an argument rather than reading `process.env` itself, so
 * the CLI (dotenv-loaded) and the in-app action (runtime env) share one tested
 * function.
 *
 *   ETHERSCAN_API_KEY        required for any resolve; one key, every chain
 *   EXPLORER_THROTTLE_MS     ms between calls, default 250
 *   EXPLORER_MAX_UPGRADES    cap on upgrade_events written per deployment
 *
 * Server-only. `ETHERSCAN_API_KEY` must never become NEXT_PUBLIC_ — a key in
 * the client bundle is a key someone else is using by tomorrow.
 *
 * Etherscan V2 is one API across every supported chain, keyed by `chainid`, so
 * there is deliberately no ETHERSCAN_KEY / BASESCAN_KEY / ARBISCAN_KEY triple
 * here. The V1 per-chain endpoints those keys belonged to are retired.
 */

export interface ExplorerConfig {
  apiKey: string | null;
  throttleMs: number;
  maxUpgrades: number;
}

const DEFAULT_THROTTLE_MS = 250;

/**
 * A proxy with hundreds of upgrades is real (some routers upgrade weekly), and
 * every one of them is an `upgrade_events` row. The cap keeps a single pin from
 * writing thousands; only the most recent matter for drift, and
 * `last_upgraded_at` is computed from the full log before the cap applies.
 */
const DEFAULT_MAX_UPGRADES = 200;

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value.replace(/[_,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Build the explorer config from an environment bag. Pure. */
export function explorerConfigFromEnv(env: EnvBag): ExplorerConfig {
  const key = env.ETHERSCAN_API_KEY?.trim();
  return {
    apiKey: key !== undefined && key.length > 0 ? key : null,
    throttleMs: parseNumber(env.EXPLORER_THROTTLE_MS, DEFAULT_THROTTLE_MS),
    maxUpgrades: parseNumber(env.EXPLORER_MAX_UPGRADES, DEFAULT_MAX_UPGRADES),
  };
}

/**
 * How many deployments the IN-APP "Resolve on-chain" sweep will touch in one
 * request.
 *
 * Seven throttled explorer calls per address is roughly two seconds each, so a
 * sweep of twelve is already at the edge of a serverless request's budget.
 * `npm run db:onchain` is the primary run path for anything larger — the same
 * CLI-first split as `db:source` in step 6, and for the same reason. Resolving
 * ONE deployment from its target page is always available and is the normal
 * interactive move.
 */
export const IN_APP_RESOLVE_LIMIT = 12;
