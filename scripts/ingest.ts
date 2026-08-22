/**
 * Ingest CLI (build step 5).
 *
 * Run with:  npm run db:ingest   (tsx scripts/ingest.ts)
 *
 * Recomputes coverage_state + drift_days for every deployment and tops up the
 * candidate research queue. Like db/seed.ts it builds its own Neon HTTP
 * connection rather than importing db/client.ts (which is server-only and would
 * throw under plain Node/tsx).
 *
 * This is the offline entry point. It does NOT call revalidatePath() — that
 * needs a Next request context, so the in-app "Run ingest" action owns cache
 * invalidation. After a CLI run, public ISR pages catch up at their next
 * revalidation (<= 1h) or on redeploy.
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema";
import { runIngest } from "../lib/ingest";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (expected in .env.local)");
}

const db = drizzle(neon(databaseUrl), { schema });

async function main() {
  console.log("Running ingest against the dev branch…");
  const summary = await runIngest(db);

  console.log(
    `Recompute: ${summary.recompute.checked} deployments checked, ` +
      `${summary.recompute.changed} changed.`,
  );
  console.table(summary.recompute.byState);
  console.log(`Queue: ${summary.candidatesCreated} candidate(s) created.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
