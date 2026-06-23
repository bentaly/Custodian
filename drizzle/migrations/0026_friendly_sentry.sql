CREATE TYPE "public"."deprivation_nation" AS ENUM('england', 'scotland', 'wales', 'northern_ireland');--> statement-breakpoint
CREATE TYPE "public"."deprivation_status" AS ENUM('pending', 'resolved', 'too_broad', 'unresolvable');--> statement-breakpoint
CREATE TABLE "deprivation_areas" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ward_code" text,
	"lad_code" text NOT NULL,
	"lad_name" text NOT NULL,
	"region_name" text,
	"nation" "deprivation_nation" NOT NULL,
	"decile" integer NOT NULL,
	"rank" integer,
	"vintage" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deprivation_status" "deprivation_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deprivation_context" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deprivation_resolved_at" timestamp;--> statement-breakpoint
CREATE INDEX "deprivation_areas_ward_idx" ON "deprivation_areas" USING btree ("ward_code");--> statement-breakpoint
CREATE INDEX "deprivation_areas_lad_idx" ON "deprivation_areas" USING btree ("lad_code");--> statement-breakpoint
CREATE INDEX "deprivation_areas_region_idx" ON "deprivation_areas" USING btree ("region_name");