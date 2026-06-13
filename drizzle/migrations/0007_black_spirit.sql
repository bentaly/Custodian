ALTER TABLE "applications" ADD COLUMN "charity_number" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "company_number" text;--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "organisation_registration_number";--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "organisation_type";--> statement-breakpoint
DROP TYPE "public"."organisation_type";