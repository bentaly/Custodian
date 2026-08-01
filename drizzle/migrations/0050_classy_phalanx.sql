CREATE TYPE "public"."award_letter_status" AS ENUM('draft', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "award_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"status" "award_letter_status" DEFAULT 'draft' NOT NULL,
	"recipient_email" text,
	"reply_to" text,
	"sender_name" text,
	"failure_reason" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "award_letters_award_id_unique" UNIQUE("award_id")
);
--> statement-breakpoint
ALTER TABLE "awards" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "awards" ADD COLUMN "special_condition" text;--> statement-breakpoint
ALTER TABLE "awards" ADD COLUMN "start_date" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "award_letter_template" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "award_letter_conditions" jsonb;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "award_letter_signatory" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "award_letter_sender_name" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "award_letter_reply_to" text;--> statement-breakpoint
ALTER TABLE "award_letters" ADD CONSTRAINT "award_letters_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_letters" ADD CONSTRAINT "award_letters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;