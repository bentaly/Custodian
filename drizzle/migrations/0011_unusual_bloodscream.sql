ALTER TABLE "application_responses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_fields" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "application_responses" CASCADE;--> statement-breakpoint
DROP TABLE "form_fields" CASCADE;--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_programme_id_programmes_id_fk";
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "round_programme_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "responses" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_round_programme_id_round_programmes_id_fk" FOREIGN KEY ("round_programme_id") REFERENCES "public"."round_programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "programme_id";