ALTER TABLE "deprivation_areas" ADD COLUMN "pfa_name" text;--> statement-breakpoint
CREATE INDEX "deprivation_areas_pfa_idx" ON "deprivation_areas" USING btree ("pfa_name");