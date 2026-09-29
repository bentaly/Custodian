ALTER TYPE "public"."audit_action" ADD VALUE 'report_returned' BEFORE 'assessment_rerun';--> statement-breakpoint
ALTER TABLE "report_ingests" ADD COLUMN "field_order" jsonb;