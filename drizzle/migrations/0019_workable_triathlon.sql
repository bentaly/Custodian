ALTER TABLE "applications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "status" SET DEFAULT 'for_review'::text;--> statement-breakpoint
DROP TYPE "public"."application_status";--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('for_review', 'shortlisted', 'awarded', 'declined');--> statement-breakpoint
-- Remap legacy status values onto the new set before casting back to the enum.
-- submitted/under_review collapse into the new unactioned state; approved -> awarded;
-- withdrawn folds into declined (closest "not proceeding" outcome).
UPDATE "applications" SET "status" = 'for_review' WHERE "status" IN ('submitted', 'under_review');--> statement-breakpoint
UPDATE "applications" SET "status" = 'awarded' WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "applications" SET "status" = 'declined' WHERE "status" = 'withdrawn';--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "status" SET DEFAULT 'for_review'::"public"."application_status";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "status" SET DATA TYPE "public"."application_status" USING "status"::"public"."application_status";
