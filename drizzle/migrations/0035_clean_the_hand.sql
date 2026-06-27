CREATE TABLE "grant_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_date" text,
	"submitted_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grant_reports" ADD CONSTRAINT "grant_reports_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;