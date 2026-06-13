ALTER TABLE "programmes" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "closed_at";--> statement-breakpoint
DROP TYPE "public"."programme_status";