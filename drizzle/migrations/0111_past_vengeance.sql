CREATE TABLE "eoi_decline_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eoi_id" uuid NOT NULL,
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
	CONSTRAINT "eoi_decline_letters_eoi_id_unique" UNIQUE("eoi_id")
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "eoi_decline_letter_template" text;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "eoi_invite_template" text;--> statement-breakpoint
ALTER TABLE "eoi_decline_letters" ADD CONSTRAINT "eoi_decline_letters_eoi_id_eois_id_fk" FOREIGN KEY ("eoi_id") REFERENCES "public"."eois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eoi_decline_letters" ADD CONSTRAINT "eoi_decline_letters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eoi_decline_letters_client_email_idx" ON "eoi_decline_letters" USING btree ("client_id",lower("recipient_email"));