CREATE TYPE "public"."grant_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "grant_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"instalment_no" integer NOT NULL,
	"amount" numeric NOT NULL,
	"due_date" text,
	"paid_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"client_id" uuid NOT NULL,
	"amount_awarded" numeric NOT NULL,
	"status" "grant_status" DEFAULT 'active' NOT NULL,
	"decision_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grant_payments" ADD CONSTRAINT "grant_payments_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;