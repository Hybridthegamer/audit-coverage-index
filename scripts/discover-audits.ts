/**
 * Audit-report discovery CLI (build step 7).
 *
 * Run with:  npm run db:audits   (tsx scripts/discover-audits.ts)
 *
 * Walks each protocol's GitHub for an `audits/` folder and records what it
 * finds: a real auditor name and, where the filename states one, a real report
 * date — the two fields step 6's DefiLlama markers structurally could not
 * carry, and the ones computeDrift needs on the audit side.
 *
 * THE PRIMARY RUN PATH. Unauthenticated GitHub allows sixty calls an hour and a
 * sweep is one folder probe per protocol plus one commit lookup per report
 * found, so anything past a handful wants `GITHUB_TOKEN` set (5,000/hr) and a
 * terminal rather than a request. The in-app button is capped for that reason.
 *
 * Builds its own Neon HTTP connection, like every other script here — db/client
 * is `server-only` and throws under tsx.
 *
 * Not destructive, and deliberately incomplete: it does NOT write
 * `audits.reviewed_commit`. The commit that added a report is a candidate, not
 * the scope of the review — reports land days or weeks after the work — so it
 * goes into the scope note as prose and a human promotes it from the target
 * page. See lib/sources/github.ts for the full argument.
 *
 * Flags:
 *   --limit=N     how many protocols to visit (default 25)
 *   --protocol=N  restrict to one protocol id
 *   --refresh     re-visit protocols that already have GitHub-sourced audits
 *   --no-commits  skip the per-report commit lookup (much cheaper, no candidate)
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema";
import { discoverAuditsForProtocols } from "../lib/ingest.sweeps";
import { githubConfigFromEnv } from "../lib/sources/github.config";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (prefix: string): number => {
  const arg = args.find((a) => a.startsWith(prefix));
  if (arg === undefined) return 0;
  const n = Number(arg.slice(prefix.length));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const limit = valueOf("--limit=") || 25;
const protocolId = valueOf("--protocol=");
const refresh = has("--refresh");
const skipCommits = has("--no-commits");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }
  const db = drizzle(neon(databaseUrl), { schema });

  const github = githubConfigFromEnv(process.env);
  const resolveCommits = skipCommits ? false : github.resolveCommits;

  console.log("Audit discovery:");
  console.table({
    limit,
    protocolId: protocolId === 0 ? "(all, ranked by TVL)" : protocolId,
    mode: refresh ? "refresh (re-visit)" : "backlog (no GitHub audits yet)",
    token: github.token === null ? "none — 60 calls/hr" : "set — 5,000 calls/hr",
    maxReports: github.maxReports,
    resolveCommits,
  });

  if (github.token === null && limit > 10) {
    console.warn(
      "  warn: no GITHUB_TOKEN and a limit above 10. Unauthenticated GitHub " +
        "allows 60 calls an hour; expect the sweep to stop short.",
    );
  }

  const summary = await discoverAuditsForProtocols(db, {
    github: { token: github.token, maxReports: github.maxReports, resolveCommits },
    limit,
    refresh,
    ...(protocolId > 0 ? { protocolId } : {}),
  });

  console.table({
    attempted: summary.attempted,
    protocolsWithReports: summary.protocolsWithReports,
    auditsCreated: summary.auditsCreated,
    failures: summary.failures.length,
  });

  for (const warning of summary.warnings) console.warn(`  warn: ${warning}`);
  for (const failure of summary.failures) {
    console.error(`  fail: protocol ${failure.protocolId} — ${failure.message}`);
  }

  if (summary.auditsCreated > 0) {
    console.log(
      "Audit rows recorded with reviewed_commit NULL. Each scope note carries a " +
        "CANDIDATE commit; open the report, confirm the scope, then record it " +
        "from the target page — that is what links an audit to a deployment.",
    );
  }

  console.log(
    "No drift recompute here: an audit with no audit_deployments link covers " +
      "nothing, so nothing moved. Link it, and that action recomputes.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
