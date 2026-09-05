CREATE TYPE "public"."partnership_event_kind" AS ENUM('logged', 'note', 'eoi_issued', 'eoi_received', 'invited', 'declined', 'reopened', 'due_diligence_run', 'archived', 'unarchived');--> statement-breakpoint
CREATE TYPE "public"."partnership_status" AS ENUM('prospective', 'eoi_issued', 'eoi_received', 'invited', 'declined');--> statement-breakpoint
CREATE TABLE "partnership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"kind" "partnership_event_kind" NOT NULL,
	"body" text NOT NULL,
	"actor_user_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"organisation_name" text NOT NULL,
	"reference" text,
	"organisation_type" text,
	"location" text,
	"charity_number" text,
	"company_number" text,
	"source" text,
	"programme_id" uuid,
	"tags" jsonb,
	"contact_name" text,
	"contact_email" text,
	"status" "partnership_status" DEFAULT 'prospective' NOT NULL,
	"amount_sought" numeric,
	"eoi_responses" jsonb,
	"eoi_received_at" timestamp,
	"due_diligence_status" "due_diligence_status" DEFAULT 'pending' NOT NULL,
	"due_diligence_checks" jsonb,
	"due_diligence_checked_at" timestamp,
	"organisation_profile" jsonb,
	"application_id" uuid,
	"archived_at" timestamp,
	"archive_note" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partnership_events" ADD CONSTRAINT "partnership_events_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnership_events" ADD CONSTRAINT "partnership_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partnership_events_partnership_idx" ON "partnership_events" USING btree ("partnership_id","occurred_at");--> statement-breakpoint
CREATE INDEX "partnerships_client_status_idx" ON "partnerships" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "partnerships_programme_idx" ON "partnerships" USING btree ("programme_id");