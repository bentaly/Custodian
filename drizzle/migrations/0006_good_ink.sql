CREATE TYPE "public"."due_diligence_status" AS ENUM('pending', 'clear', 'warning', 'blocked', 'review');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "due_diligence_status" "due_diligence_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "due_diligence_checks" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "due_diligence_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "due_diligence_data";