CREATE TYPE "public"."report_analysis_status" AS ENUM('pending', 'analysed', 'error');--> statement-breakpoint
CREATE TYPE "public"."report_match_method" AS ENUM('external_id', 'manual', 'import');--> statement-breakpoint
CREATE TABLE "report_ingests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"status" "ingest_status" DEFAULT 'needs_review' NOT NULL,
	"proposed" jsonb,
	"resolved" jsonb,
	"match_candidates" jsonb,
	"report_submission_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "report_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"grant_report_id" uuid,
	"match_method" "report_match_method" NOT NULL,
	"external_application_id" text,
	"organisation_name" text NOT NULL,
	"charity_number" text,
	"company_number" text,
	"programme_name" text,
	"amount_awarded" numeric,
	"award_date" text,
	"award_end_date" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"grant_title" text,
	"grant_purpose" text,
	"impact_summary" text NOT NULL,
	"challenges" text,
	"lessons" text,
	"case_studies" text,
	"testimonials" text,
	"other_comments" text,
	"beneficiary_count" integer,
	"delivery_area" text,
	"responses" jsonb,
	"analysis_status" "report_analysis_status" DEFAULT 'pending' NOT NULL,
	"ai_summary" text,
	"application_alignment" jsonb,
	"programme_alignment" jsonb,
	"impact_quantity" numeric,
	"impact_quantity_source" text,
	"impact_quantity_quote" text,
	"impact_unit_label" text,
	"analysis_detail" jsonb,
	"analysed_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_mappings" DROP CONSTRAINT "field_mappings_client_source_uniq";--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "form_type" text DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "impact_unit" text DEFAULT 'people' NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "impact_unit_label" text;--> statement-breakpoint
ALTER TABLE "report_ingests" ADD CONSTRAINT "report_ingests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ingests" ADD CONSTRAINT "report_ingests_report_submission_id_report_submissions_id_fk" FOREIGN KEY ("report_submission_id") REFERENCES "public"."report_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_grant_report_id_grant_reports_id_fk" FOREIGN KEY ("grant_report_id") REFERENCES "public"."grant_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_client_form_source_uniq" UNIQUE("client_id","form_type","source_key");