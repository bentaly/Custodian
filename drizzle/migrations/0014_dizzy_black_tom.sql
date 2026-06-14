ALTER TABLE "programmes" ADD COLUMN "budget" numeric;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "max_grant_amount" numeric;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "grant_duration_years" integer;--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "budget";