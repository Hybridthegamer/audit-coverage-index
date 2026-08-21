CREATE TYPE "public"."audit_source" AS ENUM('protocol_docs', 'auditor_site', 'github', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."bounty_platform" AS ENUM('immunefi', 'intigriti', 'cantina', 'sherlock', 'self', 'none');--> statement-breakpoint
CREATE TYPE "public"."chain" AS ENUM('ethereum', 'arbitrum', 'base', 'optimism', 'bsc', 'polygon', 'solana', 'stacks', 'aptos', 'sui', 'osmosis', 'neutron', 'injective', 'sei', 'starknet', 'ton');--> statement-breakpoint
CREATE TYPE "public"."coverage_state" AS ENUM('current', 'drifted', 'uncovered', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."disclosure_event_type" AS ENUM('initial_contact', 'follow_up', 'reply_received', 'report_sent', 'ack', 'fix_deployed', 'payout', 'escalated_seal911', 'published');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('draft', 'contact_sent', 'acknowledged', 'triaged', 'accepted', 'fixed', 'disputed', 'duplicate', 'no_response');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('inbound_form', 'outbound', 'referral');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'replied', 'scoping', 'proposal_sent', 'won', 'lost', 'cold');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('candidate', 'queued', 'in_review', 'cleared', 'finding_found', 'dropped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_deployments" (
	"audit_id" integer NOT NULL,
	"deployment_id" integer NOT NULL,
	CONSTRAINT "audit_deployments_audit_id_deployment_id_pk" PRIMARY KEY("audit_id","deployment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"protocol_id" integer NOT NULL,
	"auditor" text NOT NULL,
	"report_url" text,
	"report_date" date,
	"reviewed_commit" text,
	"scope_note" text,
	"source" "audit_source" DEFAULT 'protocol_docs' NOT NULL,
	"verified_by_me" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deployments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"protocol_id" integer NOT NULL,
	"chain" "chain" NOT NULL,
	"address_or_program_id" text NOT NULL,
	"label" text,
	"tvl_usd" numeric(30, 2),
	"is_upgradeable" boolean DEFAULT false NOT NULL,
	"upgrade_authority" text,
	"deployed_at" timestamp with time zone,
	"last_upgraded_at" timestamp with time zone,
	"deployed_commit" text,
	"source_verified" boolean DEFAULT false NOT NULL,
	"explorer_url" text,
	"drift_score" numeric(20, 4),
	"drift_days" integer,
	"coverage_state" "coverage_state" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disclosure_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "disclosure_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"finding_id" integer NOT NULL,
	"event_type" "disclosure_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"deployment_id" integer NOT NULL,
	"title" text NOT NULL,
	"severity" text,
	"immunefi_class" text,
	"funds_at_risk_usd" numeric(20, 2),
	"status" "finding_status" DEFAULT 'draft' NOT NULL,
	"summary" text,
	"root_cause" text,
	"attack_path" text,
	"preconditions" text,
	"impact" text,
	"recommended_fix" text,
	"poc_ref" text,
	"in_post_audit_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"protocol_id" integer,
	"source" "lead_source" NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_handle" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"engagement_value_usd" numeric(20, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outreach_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "protocols" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "protocols_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"defillama_id" text,
	"github_repo" text,
	"twitter" text,
	"security_contact" text,
	"has_bounty" boolean DEFAULT false NOT NULL,
	"bounty_platform" "bounty_platform" DEFAULT 'none' NOT NULL,
	"bounty_url" text,
	"public_note" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocols_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queue_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"deployment_id" integer NOT NULL,
	"status" "queue_status" DEFAULT 'candidate' NOT NULL,
	"priority" integer,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"clear_reason" text,
	"research_log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_items_clear_reason_required" CHECK ("queue_items"."status" <> 'cleared' OR "queue_items"."clear_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upgrade_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upgrade_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"deployment_id" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"tx_hash" text,
	"new_implementation" text,
	"block_number" bigint
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_deployments" ADD CONSTRAINT "audit_deployments_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_deployments" ADD CONSTRAINT "audit_deployments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audits" ADD CONSTRAINT "audits_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deployments" ADD CONSTRAINT "deployments_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disclosure_events" ADD CONSTRAINT "disclosure_events_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "upgrade_events" ADD CONSTRAINT "upgrade_events_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
