import { DEFAULT_FILTER, type CurationFilter } from "@/lib/sources/defillama";

/**
 * Curation config for the DefiLlama source (build step 6).
 *
 * The thresholds are policy, not code, so they live in the environment and can
 * be widened without a deploy. `filterFromEnv` is pure — it takes the env bag
 * as an argument rather than reading `process.env` itself — so the parsing
 * rules are testable and the same function serves the CLI (which loads
 * .env.local via dotenv) and the in-app action (which gets the runtime env).
 *
 * Every variable is optional; an unset or unparseable value falls back to
 * DEFAULT_FILTER rather than throwing. A sourcing run that silently imports the
 * agreed default set is a better failure mode than one that aborts because a
 * comma-separated list had a stray space.
 *
 *   DEFILLAMA_MIN_TVL_USD       number, default 1000000
 *   DEFILLAMA_MAX_TVL_USD       number, default 50000000; 0 = no ceiling
 *   DEFILLAMA_CATEGORIES        comma list, default all ("Dexs,Lending")
 *   DEFILLAMA_CHAINS            comma list, default all ("Ethereum,Base")
 *   DEFILLAMA_INCLUDE_INACTIVE  "true" keeps rugged/deprecated/dead rows
 *   DEFILLAMA_MAX_PROTOCOLS     number, 0/unset = no cap
 *
 * These are server-only knobs. None is NEXT_PUBLIC_ and none may become one:
 * the curation policy is the shape of the private research queue.
 */

export type EnvBag = Record<string, string | undefined>;

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value.replace(/[_,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** `"Dexs, Lending"` → `["Dexs", "Lending"]`. Empty or unset → null (= all). */
function parseList(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

/** Build the curation filter from an environment bag. Pure. */
export function filterFromEnv(env: EnvBag): CurationFilter {
  return {
    minTvlUsd: parseNumber(env.DEFILLAMA_MIN_TVL_USD, DEFAULT_FILTER.minTvlUsd),
    maxTvlUsd: parseNumber(env.DEFILLAMA_MAX_TVL_USD, DEFAULT_FILTER.maxTvlUsd),
    categories: parseList(env.DEFILLAMA_CATEGORIES),
    chains: parseList(env.DEFILLAMA_CHAINS),
    includeInactive: parseBool(
      env.DEFILLAMA_INCLUDE_INACTIVE,
      DEFAULT_FILTER.includeInactive,
    ),
    maxProtocols: parseNumber(env.DEFILLAMA_MAX_PROTOCOLS, DEFAULT_FILTER.maxProtocols),
  };
}

/**
 * How many protocols the IN-APP sync button will import in one request.
 *
 * The CLI (`npm run db:source`) is the primary run path precisely because the
 * full set is ~1,300 protocols and each one is a handful of round trips over
 * the Neon HTTP driver — comfortably past a serverless function's budget. The
 * button exists for a quick top-of-the-market refresh, so it caps the set to
 * the biggest N by TVL. Raise it only if you have measured the request.
 */
export const IN_APP_SYNC_LIMIT = 150;
