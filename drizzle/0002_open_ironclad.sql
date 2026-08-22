ALTER TYPE "public"."audit_source" ADD VALUE 'defillama';--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "tvl_usd" numeric(30, 2);