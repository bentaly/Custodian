ALTER TYPE "public"."audit_action" ADD VALUE 'grant_payment_amended';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'application_comment_deleted';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'application_vote_recorded_by_admin';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'grant_report_milestone_added';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'grant_report_milestone_changed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'grant_report_milestone_removed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'grant_report_reviewed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'award_letter_resent';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'api_key_created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'api_key_revoked';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'invitation_sent';--> statement-breakpoint
ALTER TABLE "application_votes" ADD COLUMN "recorded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "application_votes" ADD CONSTRAINT "application_votes_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;