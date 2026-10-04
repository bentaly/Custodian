CREATE TYPE "public"."eoi_status" AS ENUM('submitted', 'invited_to_apply', 'declined');--> statement-breakpoint
ALTER TYPE "public"."partnership_event_kind" ADD VALUE 'emailed';--> statement-breakpoint
ALTER TYPE "public"."partnership_event_kind" ADD VALUE 'shortlisted';--> statement-breakpoint
ALTER TYPE "public"."partnership_event_kind" ADD VALUE 'applied';--> statement-breakpoint
ALTER TYPE "public"."partnership_status" ADD VALUE 'applied';--> statement-breakpoint
CREATE TABLE "eois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"programme_id" uuid,
	"partnership_id" uuid,
	"organisation_name" text NOT NULL,
	"reference" text,
	"contact_email" text,
	"charity_number" text,
	"company_number" text,
	"amount_indicative" numeric,
	"responses" jsonb NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"status" "eoi_status" DEFAULT 'submitted' NOT NULL,
	"application_id" uuid,
	"decided_at" timestamp,
	"decided_by_user_id" text,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "proposed_purpose" text;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "proposed_impact_quantity" numeric;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "custodian_score_status" "custodian_score_status" DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "custodian_score" integer;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "custodian_score_detail" jsonb;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "custodian_scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "accepts_eois" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "eoi_form_url" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "application_form_url" text;--> statement-breakpoint
ALTER TABLE "eois" ADD CONSTRAINT "eois_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eois" ADD CONSTRAINT "eois_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eois" ADD CONSTRAINT "eois_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eois" ADD CONSTRAINT "eois_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eois" ADD CONSTRAINT "eois_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eois_client_status_idx" ON "eois" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "eois_partnership_idx" ON "eois" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "eois_application_idx" ON "eois" USING btree ("application_id");