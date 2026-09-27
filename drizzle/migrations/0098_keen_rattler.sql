ALTER TYPE "public"."audit_action" ADD VALUE 'application_edited' BEFORE 'application_awarded';--> statement-breakpoint
ALTER TYPE "public"."custodian_score_status" ADD VALUE 'waiting';--> statement-breakpoint
CREATE TABLE "application_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"field" text NOT NULL,
	"method" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"source_key" text,
	"replaced_source_key" text,
	"edited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "amount_requested" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "themes_set_by" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "themes_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "application_edits" ADD CONSTRAINT "application_edits_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_edits" ADD CONSTRAINT "application_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_edits_application_idx" ON "application_edits" USING btree ("application_id","created_at");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_themes_set_by_users_id_fk" FOREIGN KEY ("themes_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;