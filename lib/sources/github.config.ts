import type { EnvBag } from "@/lib/sources/defillama.config";

/**
 * GitHub audit-discovery config (build step 7).
 *
 * Pure parser over an env bag, like the other two source configs.
 *
 *   GITHUB_TOKEN           optional; lifts the rate limit 60/hr → 5,000/hr
 *   GITHUB_MAX_REPORTS     reports imported per repo, default 40
 *   GITHUB_RESOLVE_COMMITS "false" skips the per-file commit lookup
 *
 * Server-only, and `GITHUB_TOKEN` especially: it is a credential, it must never
 * become NEXT_PUBLIC_, and a read-only fine-grained token with public-repo
 * access is all this needs. Discovery reads public repositories only.
 *
 * Without a token the module still works — sixty calls an hour is enough for
 * interactive use from a target page, and roughly one protocol per run. The
 * CLI sweep is the thing that wants the token.
 */

export interface GithubConfig {
  token: string | null;
  maxReports: number;
  resolveCommits: boolean;
}

const DEFAULT_MAX_REPORTS = 40;

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value.replace(/[_,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

export function githubConfigFromEnv(env: EnvBag): GithubConfig {
  const token = env.GITHUB_TOKEN?.trim();
  return {
    token: token !== undefined && token.length > 0 ? token : null,
    maxReports: parseNumber(env.GITHUB_MAX_REPORTS, DEFAULT_MAX_REPORTS),
    resolveCommits: parseBool(env.GITHUB_RESOLVE_COMMITS, true),
  };
}

/**
 * How many protocols the in-app "Discover audits" sweep covers in one request.
 *
 * Each protocol is one folder probe plus a call per report found, so twenty-five
 * is comfortably inside a serverless budget with a token and comfortably outside
 * the 60/hr limit without one. `npm run db:audits` is the sweep for the full
 * curated set — the same CLI-first split as `db:source` and `db:onchain`.
 */
export const IN_APP_DISCOVER_LIMIT = 25;
