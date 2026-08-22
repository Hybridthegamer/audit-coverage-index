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
import { runIngest } from "@/lib/ingest";

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
