ALTER TABLE "applications" DROP COLUMN "charity_number";--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "contact_name";--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "contact_email";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "organisation_registration_number" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "organisation_type" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "bank_sort_code" text;
