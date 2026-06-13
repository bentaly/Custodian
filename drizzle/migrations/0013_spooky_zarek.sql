CREATE TYPE "public"."custodian_score_status" AS ENUM('pending', 'scored', 'error');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "custodian_score_status" "custodian_score_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "custodian_score" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "custodian_score_detail" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "custodian_scored_at" timestamp;