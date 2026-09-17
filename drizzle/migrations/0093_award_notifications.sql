CREATE TABLE "award_notification_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "award_notification_sends_award_user_uniq" UNIQUE("award_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "award_notifications" boolean;--> statement-breakpoint
ALTER TABLE "award_notification_sends" ADD CONSTRAINT "award_notification_sends_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_notification_sends" ADD CONSTRAINT "award_notification_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;