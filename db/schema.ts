import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

// `chain` is the one enum expected to churn (new chains added over time).
// Seeded with this build's 3 chains plus the wider set from the sourcing
// playbook so early deployments don't each need an ALTER TYPE migration.
export const chainEnum = pgEnum("chain", [
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
]);

export const bountyPlatformEnum = pgEnum("bounty_platform", [
  "immunefi",
  "intigriti",
  "cantina",
  "sherlock",
  "self",
  "none",
]);

export const coverageStateEnum = pgEnum("coverage_state", [
  "current",
  "drifted",
  "uncovered",
  "unknown",
]);

export const auditSourceEnum = pgEnum("audit_source", [
  "protocol_docs",
  "auditor_site",
  "github",
  "submitted",
]);

export const leadSourceEnum = pgEnum("lead_source", [
  "inbound_form",
  "outbound",
  "referral",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "replied",
  "scoping",
  "proposal_sent",
  "won",
  "lost",
  "cold",
]);

export const queueStatusEnum = pgEnum("queue_status", [
  "candidate",
  "queued",
  "in_review",
  "cleared",
  "finding_found",
  "dropped",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "draft",
  "contact_sent",
  "acknowledged",
  "triaged",
  "accepted",
  "fixed",
  "disputed",
  "duplicate",
  "no_response",
]);

export const disclosureEventTypeEnum = pgEnum("disclosure_event_type", [
  "initial_contact",
  "follow_up",
  "reply_received",
  "report_sent",
  "ack",
  "fix_deployed",
  "payout",
  "escalated_seal911",
  "published",
]);

/* ------------------------------------------------------------------ *
 * PUBLIC tables
 * ------------------------------------------------------------------ */

export const protocols = pgTable("protocols", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  website: text("website"),
  defillamaId: text("defillama_id"),
  githubRepo: text("github_repo"),
  twitter: text("twitter"),
  securityContact: text("security_contact"),
  hasBounty: boolean("has_bounty").notNull().default(false),
  bountyPlatform: bountyPlatformEnum("bounty_platform").notNull().default("none"),
  bountyUrl: text("bounty_url"),
  publicNote: text("public_note"),
  // is_published gates public visibility; defaults false so nothing leaks
  // before the audit data has been eyeballed.
  isPublished: boolean("is_published").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deployments = pgTable("deployments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  protocolId: integer("protocol_id")
    .notNull()
    .references(() => protocols.id, { onDelete: "cascade" }),
  chain: chainEnum("chain").notNull(),
  addressOrProgramId: text("address_or_program_id").notNull(),
  label: text("label"),
  tvlUsd: numeric("tvl_usd", { precision: 30, scale: 2 }),
  isUpgradeable: boolean("is_upgradeable").notNull().default(false),
  upgradeAuthority: text("upgrade_authority"),
  // Original on-chain deployment date. Distinct from lastUpgradedAt and NOT
  // in the SPEC column list — added because the drift rule measures an
  // uncovered deployment's drift "from deployment date", which needs a home.
  deployedAt: timestamp("deployed_at", { withTimezone: true }),
  lastUpgradedAt: timestamp("last_upgraded_at", { withTimezone: true }),
  deployedCommit: text("deployed_commit"),
  sourceVerified: boolean("source_verified").notNull().default(false),
  explorerUrl: text("explorer_url"),
  // NOTE: SPEC lists a `drift_score` column but defines no formula for it
  // ("nothing weighted"). Deliberately omitted — drift_days + coverage_state
  // are the public numbers (written by computeDrift), and the only weighted
  // metric, priority_score, is computed at query time for /workspace/targets.
  driftDays: integer("drift_days"),
  coverageState: coverageStateEnum("coverage_state").notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const audits = pgTable("audits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  protocolId: integer("protocol_id")
    .notNull()
    .references(() => protocols.id, { onDelete: "cascade" }),
  auditor: text("auditor").notNull(),
  reportUrl: text("report_url"),
  // Nullable: a missing report date is one of the inputs that drives the
  // 'unknown' coverage state rather than a guess.
  reportDate: date("report_date", { mode: "date" }),
  reviewedCommit: text("reviewed_commit"),
  scopeNote: text("scope_note"),
  source: auditSourceEnum("source").notNull().default("protocol_docs"),
  verifiedByMe: boolean("verified_by_me").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The 9th table: replaces audits.covers_deployment_ids (jsonb) with a real
// many-to-many so "which audits cover this deployment" is an indexed join
// with referential integrity in both directions.
export const auditDeployments = pgTable(
  "audit_deployments",
  {
    auditId: integer("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.deploymentId] })],
);

export const upgradeEvents = pgTable("upgrade_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  deploymentId: integer("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  txHash: text("tx_hash"),
  newImplementation: text("new_implementation"),
  blockNumber: bigint("block_number", { mode: "number" }),
});

/* ------------------------------------------------------------------ *
 * PRIVATE tables — never joined from a public route/loader/handler.
 * ------------------------------------------------------------------ */

export const leads = pgTable("leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Nullable: inbound leads can arrive from teams not in the index.
  protocolId: integer("protocol_id").references(() => protocols.id, {
    onDelete: "set null",
  }),
  source: leadSourceEnum("source").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactHandle: text("contact_handle"),
  status: leadStatusEnum("status").notNull().default("new"),
  engagementValueUsd: numeric("engagement_value_usd", { precision: 20, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outreachEvents = pgTable("outreach_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  channel: text("channel"),
  note: text("note"),
});

export const queueItems = pgTable(
  "queue_items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    status: queueStatusEnum("status").notNull().default("candidate"),
    priority: integer("priority"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Required when cleared — enforced at the DB level so you can never
    // clear a target without recording why.
    clearReason: text("clear_reason"),
    researchLog: text("research_log"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "queue_items_clear_reason_required",
      sql`${t.status} <> 'cleared' OR ${t.clearReason} IS NOT NULL`,
    ),
  ],
);

export const findings = pgTable("findings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  deploymentId: integer("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  severity: text("severity"),
  immunefiClass: text("immunefi_class"),
  fundsAtRiskUsd: numeric("funds_at_risk_usd", { precision: 20, scale: 2 }),
  status: findingStatusEnum("status").notNull().default("draft"),
  summary: text("summary"),
  rootCause: text("root_cause"),
  attackPath: text("attack_path"),
  preconditions: text("preconditions"),
  impact: text("impact"),
  recommendedFix: text("recommended_fix"),
  // Pointer only (repo URL / gist ID / local path). There is deliberately
  // NO poc_code column — runnable exploits never live in this database.
  pocRef: text("poc_ref"),
  inPostAuditCode: boolean("in_post_audit_code").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disclosureEvents = pgTable("disclosure_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  findingId: integer("finding_id")
    .notNull()
    .references(() => findings.id, { onDelete: "cascade" }),
  eventType: disclosureEventTypeEnum("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  channel: text("channel"),
  note: text("note"),
});

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const protocolsRelations = relations(protocols, ({ many }) => ({
  deployments: many(deployments),
  audits: many(audits),
  leads: many(leads),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  protocol: one(protocols, {
    fields: [deployments.protocolId],
    references: [protocols.id],
  }),
  upgradeEvents: many(upgradeEvents),
  auditDeployments: many(auditDeployments),
  queueItems: many(queueItems),
  findings: many(findings),
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  protocol: one(protocols, {
    fields: [audits.protocolId],
    references: [protocols.id],
  }),
  auditDeployments: many(auditDeployments),
}));

export const auditDeploymentsRelations = relations(auditDeployments, ({ one }) => ({
  audit: one(audits, {
    fields: [auditDeployments.auditId],
    references: [audits.id],
  }),
  deployment: one(deployments, {
    fields: [auditDeployments.deploymentId],
    references: [deployments.id],
  }),
}));

export const upgradeEventsRelations = relations(upgradeEvents, ({ one }) => ({
  deployment: one(deployments, {
    fields: [upgradeEvents.deploymentId],
    references: [deployments.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  protocol: one(protocols, {
    fields: [leads.protocolId],
    references: [protocols.id],
  }),
  outreachEvents: many(outreachEvents),
}));

export const outreachEventsRelations = relations(outreachEvents, ({ one }) => ({
  lead: one(leads, {
    fields: [outreachEvents.leadId],
    references: [leads.id],
  }),
}));

export const queueItemsRelations = relations(queueItems, ({ one }) => ({
  deployment: one(deployments, {
    fields: [queueItems.deploymentId],
    references: [deployments.id],
  }),
}));

export const findingsRelations = relations(findings, ({ one, many }) => ({
  deployment: one(deployments, {
    fields: [findings.deploymentId],
    references: [deployments.id],
  }),
  disclosureEvents: many(disclosureEvents),
}));

export const disclosureEventsRelations = relations(disclosureEvents, ({ one }) => ({
  finding: one(findings, {
    fields: [disclosureEvents.findingId],
    references: [findings.id],
  }),
}));
