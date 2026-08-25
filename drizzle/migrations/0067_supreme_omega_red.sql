CREATE TYPE "public"."api_key_kind" AS ENUM('secret', 'webhook');--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "kind" "api_key_kind" DEFAULT 'secret' NOT NULL;