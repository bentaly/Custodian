CREATE TYPE "public"."ingest_status" AS ENUM('needs_review', 'ai_proposed', 'complete');--> statement-breakpoint
CREATE TABLE "application_ingests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"round_programme_id" uuid NOT NULL,
	"external_application_id" text,
	"raw_payload" jsonb NOT NULL,
	"status" "ingest_status" DEFAULT 'needs_review' NOT NULL,
	"proposed" jsonb,
	"resolved" jsonb,
	"application_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	CONSTRAINT "application_ingests_client_external_uniq" UNIQUE("client_id","external_application_id")
);
--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"canonical_field" text NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_mappings_client_source_uniq" UNIQUE("client_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "external_application_id" text;--> statement-breakpoint
ALTER TABLE "application_ingests" ADD CONSTRAINT "application_ingests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_ingests" ADD CONSTRAINT "application_ingests_round_programme_id_round_programmes_id_fk" FOREIGN KEY ("round_programme_id") REFERENCES "public"."round_programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_ingests" ADD CONSTRAINT "application_ingests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;