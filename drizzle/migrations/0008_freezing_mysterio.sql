ALTER TABLE "form_fields" ALTER COLUMN "field_type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "form_fields" SET "field_type" = 'text' WHERE "field_type" NOT IN ('text', 'number');--> statement-breakpoint
DROP TYPE "public"."field_type";--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'number');--> statement-breakpoint
ALTER TABLE "form_fields" ALTER COLUMN "field_type" SET DATA TYPE "public"."field_type" USING "field_type"::"public"."field_type";--> statement-breakpoint
ALTER TABLE "form_fields" DROP COLUMN "required";--> statement-breakpoint
ALTER TABLE "form_fields" DROP COLUMN "options";