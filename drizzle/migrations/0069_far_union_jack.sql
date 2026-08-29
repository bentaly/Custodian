ALTER TABLE "application_ingests" ADD COLUMN "field_order" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submitted_fields" jsonb;