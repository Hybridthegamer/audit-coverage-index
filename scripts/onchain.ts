/**
 * On-chain resolution CLI (build step 7).
 *
 * Run with:  npm run db:onchain   (tsx scripts/onchain.ts)
 *
 * THE PRIMARY RUN PATH, for the same reason `db:source` is: one address costs
 * seven throttled explorer calls, so a backlog of even fifty pins is minutes of
 * wall clock — well past what a serverless request should attempt. The in-app
 * "Resolve on-chain" button is capped at a dozen and exists because only it can
 * call revalidatePath.
 *
 * Like db/seed.ts, scripts/ingest.ts and scripts/source-defillama.ts it builds
 * its own Neon HTTP connection rather than importing db/client.ts, which is
 * `server-only` and throws under plain Node/tsx.
 *
 * Not destructive. It patches pinned deployments with what the explorer knows
 * and appends upgrade events it has not already recorded; a re-run over
 * unchanged contracts writes nothing.
 *
 * What it will NOT do: set `deployed_commit`. A block explorer has bytecode and
 * verified source, never the commit that produced it — see lib/sources/
 * explorer.ts. Pin the commit from the target page; that is the assertion that
 * lets computeDrift leave `unknown`.
 *
 * Flags:
 *   --limit=N     how many deployments to resolve (default 25)
 *   --refresh     re-resolve deployments already carrying explorer data
 *   --protocol=N  restrict to one protocol id
 *   --no-ingest   skip the drift recompute afterwards
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema";
import { runIngest } from "../lib/ingest";
import { resolveDeploymentsOnChain } from "../lib/ingest.sweeps";
import { SUPPORTED_CHAINS } from "../lib/sources/explorer";
import { explorerConfigFromEnv } from "../lib/sources/explorer.config";

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
const skipIngest = has("--no-ingest");

async function main() {
  const explorer = explorerConfigFromEnv(process.env);
  if (explorer.apiKey === null) {
    throw new Error(
      "ETHERSCAN_API_KEY is not set (expected in .env.local). One Etherscan V2 " +
        "key covers every supported chain: " +
        SUPPORTED_CHAINS.join(", "),
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }
  const db = drizzle(neon(databaseUrl), { schema });

  console.log("Explorer resolution:");
  console.table({
    chains: SUPPORTED_CHAINS.join(", "),
    limit,
    protocolId: protocolId === 0 ? "(all)" : protocolId,
    mode: refresh ? "refresh (re-resolve resolved pins)" : "backlog (never resolved)",
    throttleMs: explorer.throttleMs,
    maxUpgrades: explorer.maxUpgrades,
  });

  const summary = await resolveDeploymentsOnChain(db, {
    explorer: { apiKey: explorer.apiKey, throttleMs: explorer.throttleMs },
    maxUpgrades: explorer.maxUpgrades,
    limit,
    refresh,
    ...(protocolId > 0 ? { protocolId } : {}),
  });

  console.table({
    attempted: summary.attempted,
    resolved: summary.resolved,
    deploymentsChanged: summary.deploymentsChanged,
    upgradeEventsCreated: summary.upgradeEventsCreated,
    skippedUnsupported: summary.skippedUnsupported,
    failures: summary.failures.length,
  });

  for (const warning of summary.warnings) console.warn(`  warn: ${warning}`);
  for (const failure of summary.failures) {
    console.error(`  fail: deployment ${failure.deploymentId} — ${failure.message}`);
  }

  if (summary.resolved > 0) {
    console.log(
      "Explorer facts recorded. deployed_commit is NOT among them — no explorer " +
        "knows a commit. Pin it from the target page to move a target off `unknown`.",
    );
  }

  if (skipIngest) {
    console.log("--no-ingest: skipping the drift recompute.");
    return;
  }

  console.log("Running ingest (drift recompute + queue top-up)…");
  const ingest = await runIngest(db);
  console.log(
    `Recompute: ${ingest.recompute.checked} deployment(s) checked, ` +
      `${ingest.recompute.changed} changed. ` +
      `Queue: ${ingest.candidatesCreated} candidate(s) created.`,
  );
  console.table(ingest.recompute.byState);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
