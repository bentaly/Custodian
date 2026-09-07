ALTER TYPE "public"."audit_action" ADD VALUE 'decline_letters_sent';--> statement-breakpoint
CREATE TABLE "decline_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "award_letter_status" DEFAULT 'draft' NOT NULL,
	"recipient_email" text,
	"reply_to" text,
	"sender_name" text,
	"failure_reason" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "decline_letters_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "decline_letter_template" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "decline_letter_signatory" text;--> statement-breakpoint
ALTER TABLE "decline_letters" ADD CONSTRAINT "decline_letters_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decline_letters" ADD CONSTRAINT "decline_letters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;