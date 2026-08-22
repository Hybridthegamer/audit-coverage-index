"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  deployments,
  disclosureEvents,
  findings,
  protocols,
  queueItems,
} from "@/db/schema";
import { runIngest, syncFromDefiLlama } from "@/lib/ingest";
import {
  applyResolvedDeployment,
  pinDeployment,
  recordDeployedCommit,
  recordReviewedCommit,
  setAuditCoverage,
} from "@/lib/ingest.onchain";
import {
  discoverAuditsForProtocols,
  resolveDeploymentsOnChain,
} from "@/lib/ingest.sweeps";
import { fetchProtocols } from "@/lib/sources/defillama";
import { filterFromEnv, IN_APP_SYNC_LIMIT } from "@/lib/sources/defillama.config";
import {
  isSupportedChain,
  resolveDeployment,
  SUPPORTED_CHAINS,
} from "@/lib/sources/explorer";
import {
  explorerConfigFromEnv,
  IN_APP_RESOLVE_LIMIT,
} from "@/lib/sources/explorer.config";
import {
  githubConfigFromEnv,
  IN_APP_DISCOVER_LIMIT,
} from "@/lib/sources/github.config";

/* ═══════════════════════════════════════════════════════════════════════════
   PRIVATE MUTATIONS (build step 5).

   Every write behind /workspace: the findings editor, the disclosure timeline,
   queue transitions, the publish toggle, and the in-app ingest run. These are
   server actions, so they only ever execute server-side; they are invoked from
   /workspace pages, which means the same middleware gate that protects the
   pages protects the action POSTs.

   Cache rules:
     · Private writes touch only force-dynamic /workspace pages, so a
       revalidatePath there is belt-and-braces, not load-bearing.
     · The publish toggle and the ingest run change PUBLIC, ISR-cached pages, so
       they must revalidatePath the affected public routes — this is the
       "unpublishing is delayed unless you revalidate" rule from step 3, finally
       given the code that makes it immediate.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── FormData helpers ──────────────────────────────────────────────────── */

function optionalStr(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredStr(fd: FormData, key: string): string {
  const v = optionalStr(fd, key);
  if (v === null) throw new Error(`Missing required field: ${key}`);
  return v;
}

function optionalNumericStr(fd: FormData, key: string): string | null {
  const v = optionalStr(fd, key);
  if (v === null) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? String(n) : null;
}

function boolField(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

function intField(fd: FormData, key: string): number {
  const n = Number(fd.get(key));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid id for ${key}`);
  return n;
}

function optionalInt(fd: FormData, key: string): number | null {
  const raw = optionalStr(fd, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function asEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const FINDING_STATUSES = [
  "draft",
  "contact_sent",
  "acknowledged",
  "triaged",
  "accepted",
  "fixed",
  "disputed",
  "duplicate",
  "no_response",
] as const;

const QUEUE_STATUSES = [
  "candidate",
  "queued",
  "in_review",
  "cleared",
  "finding_found",
  "dropped",
] as const;

/** The chain enum, mirrored for the pin form's select. */
const CHAINS = [
  "ethereum",
  "arbitrum",
  "base",
  "optimism",
  "bsc",
  "polygon",
  "solana",
  "stacks",
  "aptos",
  "sui",
  "osmosis",
  "neutron",
  "injective",
  "sei",
  "starknet",
  "ton",
] as const;

const DISCLOSURE_TYPES = [
  "initial_contact",
  "follow_up",
  "reply_received",
  "report_sent",
  "ack",
  "fix_deployed",
  "payout",
  "escalated_seal911",
  "published",
] as const;

/** The finding body fields shared by create + update. */
function readFindingFields(fd: FormData) {
  return {
    title: requiredStr(fd, "title"),
    severity: optionalStr(fd, "severity"),
    immunefiClass: optionalStr(fd, "immunefiClass"),
    fundsAtRiskUsd: optionalNumericStr(fd, "fundsAtRiskUsd"),
    status: asEnum(optionalStr(fd, "status"), FINDING_STATUSES, "draft"),
    summary: optionalStr(fd, "summary"),
    rootCause: optionalStr(fd, "rootCause"),
    attackPath: optionalStr(fd, "attackPath"),
    preconditions: optionalStr(fd, "preconditions"),
    impact: optionalStr(fd, "impact"),
    recommendedFix: optionalStr(fd, "recommendedFix"),
    // Pointer only — there is no poc_code column, ever (hard constraint).
    pocRef: optionalStr(fd, "pocRef"),
    inPostAuditCode: boolField(fd, "inPostAuditCode"),
  };
}

/* ─── Findings ──────────────────────────────────────────────────────────── */

export async function createFinding(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  const fields = readFindingFields(fd);

  const [created] = await db
    .insert(findings)
    .values({ deploymentId, ...fields })
    .returning({ id: findings.id });

  revalidatePath(`/workspace/targets/${deploymentId}`);
  redirect(`/workspace/findings/${created!.id}`);
}

export async function updateFinding(fd: FormData): Promise<void> {
  const findingId = intField(fd, "findingId");
  const fields = readFindingFields(fd);

  const [updated] = await db
    .update(findings)
    .set(fields)
    .where(eq(findings.id, findingId))
    .returning({ deploymentId: findings.deploymentId });

  if (updated) revalidatePath(`/workspace/targets/${updated.deploymentId}`);
  revalidatePath(`/workspace/findings/${findingId}`);
  redirect(`/workspace/findings/${findingId}`);
}

export async function deleteFinding(fd: FormData): Promise<void> {
  const findingId = intField(fd, "findingId");
  const [deleted] = await db
    .delete(findings)
    .where(eq(findings.id, findingId))
    .returning({ deploymentId: findings.deploymentId });

  const deploymentId = deleted?.deploymentId;
  if (deploymentId) revalidatePath(`/workspace/targets/${deploymentId}`);
  redirect(deploymentId ? `/workspace/targets/${deploymentId}` : "/workspace");
}

/* ─── Disclosure timeline ───────────────────────────────────────────────── */

export async function addDisclosureEvent(fd: FormData): Promise<void> {
  const findingId = intField(fd, "findingId");
  const eventType = asEnum(
    optionalStr(fd, "eventType"),
    DISCLOSURE_TYPES,
    "follow_up",
  );
  const channel = optionalStr(fd, "channel");
  const note = optionalStr(fd, "note");
  const occurredRaw = optionalStr(fd, "occurredAt");
  const occurredAt = occurredRaw ? new Date(occurredRaw) : new Date();

  await db.insert(disclosureEvents).values({
    findingId,
    eventType,
    channel,
    note,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  });

  revalidatePath(`/workspace/findings/${findingId}`);
  redirect(`/workspace/findings/${findingId}`);
}

export async function deleteDisclosureEvent(fd: FormData): Promise<void> {
  const eventId = intField(fd, "eventId");
  const findingId = intField(fd, "findingId");
  await db.delete(disclosureEvents).where(eq(disclosureEvents.id, eventId));
  revalidatePath(`/workspace/findings/${findingId}`);
  redirect(`/workspace/findings/${findingId}`);
}

/* ─── Queue transitions ─────────────────────────────────────────────────── */

/**
 * Move a target through the research-queue states, upserting the latest queue
 * item for the deployment and stamping the right timestamps. `cleared` requires
 * a reason — enforced here for a clean message, and again by the DB check
 * constraint as the real guard.
 */
export async function transitionQueue(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  const status = asEnum(optionalStr(fd, "status"), QUEUE_STATUSES, "candidate");
  const clearReason = optionalStr(fd, "clearReason");

  if (status === "cleared" && clearReason === null) {
    throw new Error("Clearing a target requires a reason.");
  }

  const now = new Date();
  const [existing] = await db
    .select({
      id: queueItems.id,
      queuedAt: queueItems.queuedAt,
      startedAt: queueItems.startedAt,
    })
    .from(queueItems)
    .where(eq(queueItems.deploymentId, deploymentId))
    .orderBy(desc(queueItems.createdAt))
    .limit(1);

  const closed = status === "cleared" || status === "dropped" || status === "finding_found";
  const patch = {
    status,
    queuedAt:
      status === "queued" || status === "in_review"
        ? (existing?.queuedAt ?? now)
        : (existing?.queuedAt ?? null),
    startedAt:
      status === "in_review" ? (existing?.startedAt ?? now) : (existing?.startedAt ?? null),
    closedAt: closed ? now : null,
    clearReason: status === "cleared" ? clearReason : null,
  };

  if (existing) {
    await db.update(queueItems).set(patch).where(eq(queueItems.id, existing.id));
  } else {
    await db.insert(queueItems).values({ deploymentId, ...patch });
  }

  revalidatePath("/workspace");
  revalidatePath(`/workspace/targets/${deploymentId}`);
  redirect(`/workspace/targets/${deploymentId}`);
}

export async function saveResearchLog(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  const researchLog = optionalStr(fd, "researchLog");
  const priority = optionalInt(fd, "priority");

  const [existing] = await db
    .select({ id: queueItems.id })
    .from(queueItems)
    .where(eq(queueItems.deploymentId, deploymentId))
    .orderBy(desc(queueItems.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(queueItems)
      .set({ researchLog, priority })
      .where(eq(queueItems.id, existing.id));
  } else {
    await db
      .insert(queueItems)
      .values({ deploymentId, status: "candidate", researchLog, priority });
  }

  revalidatePath(`/workspace/targets/${deploymentId}`);
  redirect(`/workspace/targets/${deploymentId}`);
}

/* ─── Publish toggle ────────────────────────────────────────────────────── */

/**
 * Flip a protocol's public visibility and immediately revalidate the public
 * ISR pages so the change lands now, not at the next hourly revalidation. This
 * is the on-write revalidation step 3 said its ingest would need.
 */
export async function setPublished(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  const isPublished = boolField(fd, "isPublished");

  const [target] = await db
    .select({ protocolId: deployments.protocolId })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!target) redirect("/workspace");

  const [row] = await db
    .update(protocols)
    .set({ isPublished })
    .where(eq(protocols.id, target.protocolId))
    .returning({ slug: protocols.slug });

  // Public surfaces that list or render this protocol.
  revalidatePath("/");
  revalidatePath("/coverage");
  if (row) revalidatePath(`/protocols/${row.slug}`);
  revalidatePath(`/workspace/targets/${deploymentId}`);
  revalidatePath("/workspace");
  redirect(`/workspace/targets/${deploymentId}`);
}

/* ─── Ingest ────────────────────────────────────────────────────────────── */

/**
 * Run a full ingest pass from inside the app, then revalidate every public
 * surface a coverage change could touch. The CLI (npm run db:ingest) does the
 * same recompute but cannot revalidate — that is the reason this action exists.
 */
export async function runIngestAction(): Promise<void> {
  await runIngest(db);

  revalidatePath("/");
  revalidatePath("/coverage");
  revalidatePath("/protocols/[slug]", "page");
  revalidatePath("/workspace");
  redirect("/workspace");
}

/* ─── Sourcing (step 6) ─────────────────────────────────────────────────── */

/**
 * Pull the top slice of the curated DefiLlama set and upsert it, then recompute
 * drift and revalidate.
 *
 * Capped at IN_APP_SYNC_LIMIT protocols on purpose. `npm run db:source` is the
 * primary run path — a full $1M-floor sync is ~1,300 protocols and an 8MB fetch,
 * which is not a serverless request's job. This button is the quick
 * top-of-market refresh from inside the app, and it is the variant that can
 * call revalidatePath().
 *
 * Everything it writes lands unpublished (the sync never touches is_published),
 * so no public page gains a row from this — but a sourced audit marker can move
 * an existing deployment's coverage, hence the public revalidation.
 */
export async function syncDefiLlamaAction(): Promise<void> {
  const filter = { ...filterFromEnv(process.env), maxProtocols: IN_APP_SYNC_LIMIT };
  const records = await fetchProtocols(filter);

  await syncFromDefiLlama(db, records);
  await runIngest(db);

  revalidatePath("/");
  revalidatePath("/coverage");
  revalidatePath("/protocols/[slug]", "page");
  revalidatePath("/workspace");
  redirect("/workspace");
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 7 — pinning, resolving, discovering, and the two human assertions.

   The write actions that turn a step-6 sourced protocol into a real target.
   All of them are server actions, so the middleware gate that protects the
   /workspace pages protects these POSTs; all of them use only revalidatePath +
   redirect, never cookies(), which is the step-5 rule that keeps them safe as
   actions (auth cookie writes are route handlers — see CLAUDE.md, step 5).

   Which of these revalidate PUBLIC pages, and why: resolving a contract can
   move `is_upgradeable`, `last_upgraded_at` and — after a recompute —
   `coverage_state` and `drift_days`, all of which are rendered on the public
   index and the public protocol page. So anything that ends in a recompute
   invalidates the public ISR cache. Pinning alone does not: a new deployment
   lands under an unpublished protocol and cannot reach a public page.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Public surfaces a coverage change can touch. One place, four callers. */
function revalidatePublic(): void {
  revalidatePath("/");
  revalidatePath("/coverage");
  revalidatePath("/protocols/[slug]", "page");
}

/**
 * Pin a contract to a protocol — the single action that graduates a sourced
 * protocol into the research queue.
 *
 * Step 6 imported ~900 protocols with no deployment rows because DefiLlama has
 * no contract addresses, and `getQueue()` is keyed on deployments, so they sit
 * in a second table waiting for exactly this. One address is enough: the
 * protocol disappears from "sourced, not yet pinned" and appears in the ranked
 * queue, with a real coverage state to earn.
 */
export async function pinDeploymentAction(fd: FormData): Promise<void> {
  const protocolId = intField(fd, "protocolId");
  const chain = asEnum(optionalStr(fd, "chain"), CHAINS, "ethereum");
  const addressOrProgramId = requiredStr(fd, "addressOrProgramId");
  const label = optionalStr(fd, "label");

  const { deploymentId } = await pinDeployment(db, {
    protocolId,
    chain,
    addressOrProgramId,
    label,
  });

  revalidatePath(`/workspace/protocols/${protocolId}`);
  revalidatePath("/workspace");
  redirect(`/workspace/targets/${deploymentId}`);
}

/**
 * Resolve one pinned contract against its block explorer.
 *
 * The interactive move: you have just pinned an address and want its creation
 * date, its proxy admin and its upgrade history now. One address is seven
 * throttled calls, comfortably inside a request budget — the sweep below is
 * what has to be capped.
 *
 * Ends in a recompute because a resolved `last_upgraded_at` is a direct input
 * to computeDrift: this is the call that can move a deployment from `unknown`
 * to a real verdict, provided the commits are pinned.
 */
export async function resolveDeploymentAction(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  const config = explorerConfigFromEnv(process.env);
  if (config.apiKey === null) {
    throw new Error(
      "ETHERSCAN_API_KEY is not set. One Etherscan V2 key covers every " +
        "supported chain; add it to the environment and redeploy.",
    );
  }

  const [row] = await db
    .select({
      chain: deployments.chain,
      address: deployments.addressOrProgramId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  if (!row) redirect("/workspace");

  if (!isSupportedChain(row!.chain)) {
    throw new Error(
      `${row!.chain} has no block-explorer support (supported: ` +
        `${SUPPORTED_CHAINS.join(", ")}). Record its facts by hand.`,
    );
  }

  const resolved = await resolveDeployment(row!.chain, row!.address, {
    apiKey: config.apiKey,
    throttleMs: config.throttleMs,
  });
  await applyResolvedDeployment(db, deploymentId, resolved, config.maxUpgrades);
  await runIngest(db);

  revalidatePublic();
  revalidatePath(`/workspace/targets/${deploymentId}`);
  revalidatePath("/workspace");
  redirect(`/workspace/targets/${deploymentId}`);
}

/**
 * Sweep the backlog of never-resolved pins.
 *
 * Capped at IN_APP_RESOLVE_LIMIT for the same reason step 6's sync button is
 * capped at 150: `npm run db:onchain` is the primary run path, and this button
 * exists because only it can call revalidatePath.
 */
export async function resolveOnChainSweepAction(): Promise<void> {
  const config = explorerConfigFromEnv(process.env);
  if (config.apiKey === null) {
    throw new Error("ETHERSCAN_API_KEY is not set.");
  }

  await resolveDeploymentsOnChain(db, {
    explorer: { apiKey: config.apiKey, throttleMs: config.throttleMs },
    maxUpgrades: config.maxUpgrades,
    limit: IN_APP_RESOLVE_LIMIT,
  });
  await runIngest(db);

  revalidatePublic();
  revalidatePath("/workspace");
  redirect("/workspace");
}

/**
 * Walk a protocol's repo for audit reports.
 *
 * Writes `audits` rows with a real auditor name and, where the filename states
 * one, a real report date — the two fields step 6's DefiLlama markers could
 * never carry. It does NOT write `reviewed_commit`: the candidate goes into the
 * scope note and `recordReviewedCommitAction` below is how it gets promoted.
 * See lib/sources/github.ts for the full argument.
 *
 * No public revalidation: a new audit row cannot change a public verdict on its
 * own, because an audit with no `audit_deployments` link covers nothing. The
 * link is made by hand, and that action revalidates.
 */
export async function discoverAuditsAction(fd: FormData): Promise<void> {
  const protocolId = intField(fd, "protocolId");
  const config = githubConfigFromEnv(process.env);

  await discoverAuditsForProtocols(db, {
    github: {
      token: config.token,
      maxReports: config.maxReports,
      resolveCommits: config.resolveCommits,
    },
    limit: 1,
    protocolId,
    // A per-protocol click is always a deliberate re-check.
    refresh: true,
  });

  revalidatePath(`/workspace/protocols/${protocolId}`);
  redirect(`/workspace/protocols/${protocolId}`);
}

/** The same discovery, swept across the curated set. Capped; the CLI is primary. */
export async function discoverAuditsSweepAction(): Promise<void> {
  const config = githubConfigFromEnv(process.env);

  await discoverAuditsForProtocols(db, {
    github: {
      token: config.token,
      maxReports: config.maxReports,
      resolveCommits: config.resolveCommits,
    },
    limit: IN_APP_DISCOVER_LIMIT,
  });

  revalidatePath("/workspace");
  redirect("/workspace");
}

/* ─── The two human assertions ──────────────────────────────────────────── */

/**
 * Record the commit deployed at an address.
 *
 * Nothing automated writes this column — an explorer has bytecode, never a
 * commit (lib/sources/explorer.ts). This form is the researcher saying "I
 * matched the verified source to this commit", and it is half of what
 * computeDrift needs to leave `unknown`. Submitting it empty clears the claim,
 * which puts the deployment straight back to `unknown` on the recompute:
 * retracting has to be as easy as asserting.
 */
export async function recordDeployedCommitAction(fd: FormData): Promise<void> {
  const deploymentId = intField(fd, "deploymentId");
  await recordDeployedCommit(db, deploymentId, optionalStr(fd, "deployedCommit"));
  await runIngest(db);

  revalidatePublic();
  revalidatePath(`/workspace/targets/${deploymentId}`);
  revalidatePath("/workspace");
  redirect(`/workspace/targets/${deploymentId}`);
}

/**
 * Record the commit an audit reviewed, and the report date if it was missing.
 *
 * The other half. `recordReviewedCommit` also flips `verified_by_me`, because
 * filling this in IS the verification: somebody opened the report and read its
 * scope section. Discovery leaves a candidate sha in the scope note; this is
 * where it stops being a note.
 */
export async function recordReviewedCommitAction(fd: FormData): Promise<void> {
  const auditId = intField(fd, "auditId");
  const deploymentId = optionalInt(fd, "deploymentId");
  const dateRaw = optionalStr(fd, "reportDate");
  const parsed = dateRaw === null ? null : new Date(dateRaw);
  const reportDate =
    parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;

  await recordReviewedCommit(
    db,
    auditId,
    optionalStr(fd, "reviewedCommit"),
    reportDate,
  );
  await runIngest(db);

  revalidatePublic();
  revalidatePath("/workspace");
  if (deploymentId !== null) {
    revalidatePath(`/workspace/targets/${deploymentId}`);
    redirect(`/workspace/targets/${deploymentId}`);
  }
  redirect("/workspace");
}

/**
 * Link or unlink an audit and a deployment.
 *
 * This is the assertion the entire public verdict rests on: the join row means
 * "the commit this audit reviewed is an ancestor of what is deployed here", and
 * `recomputeDrift` trusts it as recorded ancestry (CLAUDE.md, step 5). Nothing
 * in step 7 creates one automatically — not the explorer, not the GitHub
 * discovery — because no external source can establish it. A person reads the
 * report's scope, checks the ancestry, and clicks.
 */
export async function setAuditCoverageAction(fd: FormData): Promise<void> {
  const auditId = intField(fd, "auditId");
  const deploymentId = intField(fd, "deploymentId");
  const covered = boolField(fd, "covered");

  await setAuditCoverage(db, auditId, deploymentId, covered);
  await runIngest(db);

  revalidatePublic();
  revalidatePath(`/workspace/targets/${deploymentId}`);
  revalidatePath("/workspace");
  redirect(`/workspace/targets/${deploymentId}`);
}

/**
 * Log a disclosure event straight off the submission page.
 *
 * The generator renders the email; this records that you sent it. Keeping the
 * two on one screen is the difference between a timeline that reflects reality
 * and one that gets backfilled from memory a fortnight later — and the
 * timeline is what the 90-day window in the report is computed from.
 */
export async function logSubmissionEventAction(fd: FormData): Promise<void> {
  const findingId = intField(fd, "findingId");
  const eventType = asEnum(optionalStr(fd, "eventType"), DISCLOSURE_TYPES, "report_sent");

  await db.insert(disclosureEvents).values({
    findingId,
    eventType,
    channel: optionalStr(fd, "channel"),
    note: optionalStr(fd, "note"),
    occurredAt: new Date(),
  });

  revalidatePath(`/workspace/findings/${findingId}`);
  revalidatePath(`/workspace/findings/${findingId}/submission`);
  redirect(`/workspace/findings/${findingId}/submission`);
}
