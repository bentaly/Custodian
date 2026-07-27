-- Collapse user_role to superadmin | admin | trustee | finance.
--
-- Postgres has no ALTER TYPE ... DROP VALUE, so the type is rebuilt and swapped.
-- The retired values MUST be migrated off the rows first: the USING cast below
-- fails loudly ("invalid input value for enum user_role") on any row still
-- holding manager/contributor/observer, which is the safety net we want.
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'manager';--> statement-breakpoint
UPDATE "users" SET "role" = 'trustee' WHERE "role" IN ('contributor', 'observer');--> statement-breakpoint
UPDATE "invitations" SET "role" = 'admin' WHERE "role" = 'manager';--> statement-breakpoint
UPDATE "invitations" SET "role" = 'trustee' WHERE "role" IN ('contributor', 'observer');--> statement-breakpoint

-- Defaults reference the old type and would block the swap.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint

ALTER TYPE "public"."user_role" RENAME TO "user_role_old";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('superadmin', 'admin', 'trustee', 'finance');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::text::"public"."user_role";--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::text::"public"."user_role";--> statement-breakpoint
DROP TYPE "public"."user_role_old";--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'trustee';--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'trustee';
