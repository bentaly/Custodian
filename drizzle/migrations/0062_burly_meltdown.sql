CREATE TABLE "finance_digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"week_of" text NOT NULL,
	"item_count" integer NOT NULL,
	"total_amount" numeric NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_digest_sends_user_week_uniq" UNIQUE("user_id","week_of")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_finance_digest" boolean;--> statement-breakpoint
ALTER TABLE "finance_digest_sends" ADD CONSTRAINT "finance_digest_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_digest_sends" ADD CONSTRAINT "finance_digest_sends_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;