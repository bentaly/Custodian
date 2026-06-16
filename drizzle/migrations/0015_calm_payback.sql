ALTER TABLE "round_programmes" ADD COLUMN "budget" numeric;--> statement-breakpoint
ALTER TABLE "round_programmes" ADD COLUMN "max_grant_amount" numeric;--> statement-breakpoint
ALTER TABLE "round_programmes" ADD COLUMN "grant_duration_years" integer;--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "budget";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "max_grant_amount";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "grant_duration_years";