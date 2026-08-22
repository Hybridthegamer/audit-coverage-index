/**
 * DefiLlama sourcing CLI (build step 6).
 *
 * Run with:  npm run db:source   (tsx scripts/source-defillama.ts)
 *
 * THE PRIMARY RUN PATH. The full curated set at the agreed $1M floor is ~1,300
 * protocols; fetching 8MB and writing that many rows is well past what a
 * serverless request should attempt, so the CLI (or a cron calling it) owns the
 * real sync and the in-app button is only a capped top-of-market refresh.
 *
 * Like db/seed.ts and scripts/ingest.ts it builds its own Neon HTTP connection
 * rather than importing db/client.ts, which is `server-only` and throws under
 * plain Node/tsx.
 *
 * Unlike db/seed.ts this is NOT destructive. It upserts on protocols.slug and
 * is safe to re-run — that is the whole point of it existing next to the seed.
 *
 * It does NOT call revalidatePath(): there is no Next request context out here.
 * Sourced rows land unpublished, so nothing public changes anyway; the in-app
 * "Sync from DefiLlama" action is what invalidates the ISR cache when a run
 * needs to land on the public pages immediately.
 *
 * Flags:
 *   --dry-run     fetch and report the curated set; write nothing
 *   --limit=N     cap the import to the N biggest by TVL
 *   --no-ingest   skip the drift recompute + queue top-up afterwards
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema";
import { runIngest, syncFromDefiLlama } from "../lib/ingest";
import { fetchProtocols } from "../lib/sources/defillama";
import { filterFromEnv } from "../lib/sources/defillama.config";

config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipIngest = args.has("--no-ingest");
const limitArg = [...args].find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

const filter = {
  ...filterFromEnv(process.env),
  ...(Number.isFinite(limit) && limit > 0 ? { maxProtocols: limit } : {}),
};

async function main() {
  console.log("Curation filter:");
  console.table({
    minTvlUsd: filter.minTvlUsd,
    maxTvlUsd: filter.maxTvlUsd === 0 ? "(no ceiling)" : filter.maxTvlUsd,
    categories: filter.categories?.join(", ") ?? "(all)",
    chains: filter.chains?.join(", ") ?? "(all)",
    includeInactive: filter.includeInactive,
    maxProtocols: filter.maxProtocols === 0 ? "(no cap)" : filter.maxProtocols,
  });

  console.log("Fetching https://api.llama.fi/protocols …");
  const records = await fetchProtocols(filter);
  const unaudited = records.filter((r) => r.auditLinks.length === 0 && r.auditCount === 0);
  console.log(
    `Curated ${records.length} protocol(s); ${unaudited.length} with no audit on record.`,
  );

  if (records.length > 0) {
    console.log("Top 10 by TVL:");
    console.table(
      records.slice(0, 10).map((r) => ({
        slug: r.slug,
        tvlUsd: Math.round(r.tvlUsd ?? 0),
        category: r.category ?? "—",
        audits: r.auditCount,
        links: r.auditLinks.length,
      })),
    );
  }

  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }
  const db = drizzle(neon(databaseUrl), { schema });

  console.log("Upserting protocols + audit markers…");
  const summary = await syncFromDefiLlama(db, records);
  console.table(summary);
  console.log(
    "Every sourced protocol is unpublished. Vet it in /workspace, then publish.",
  );

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
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
