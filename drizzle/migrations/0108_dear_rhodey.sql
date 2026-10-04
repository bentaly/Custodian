ALTER TYPE "public"."eoi_status" ADD VALUE 'applied';--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "delivery_area" text;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "round_programme_id" uuid;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_round_programme_id_round_programmes_id_fk" FOREIGN KEY ("round_programme_id") REFERENCES "public"."round_programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "accepts_eois";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "eoi_form_url";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "application_form_url";