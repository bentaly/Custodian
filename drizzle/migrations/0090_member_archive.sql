ALTER TYPE "public"."audit_action" ADD VALUE 'member_role_changed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'member_removed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'invitation_revoked';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "archived_at" timestamp;