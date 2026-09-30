ALTER TYPE "public"."audit_action" ADD VALUE 'application_amount_proposed';--> statement-breakpoint
ALTER TABLE "application_votes" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "amount_amended" numeric;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "amount_amended_at" timestamp;--> statement-breakpoint
-- A vote's last-cast time is its creation time for every row that predates the column.
UPDATE "application_votes" SET "updated_at" = "created_at";
