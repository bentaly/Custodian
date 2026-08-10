ALTER TABLE "applications" ADD COLUMN "grant_purpose" text;--> statement-breakpoint
-- Backfill. Every application predating this column was scored without a grant purpose,
-- and re-scoring them to fill it would move every existing Custodian score for no reason
-- a trustee could see. So they say why they are blank instead. New applications get a
-- real purpose from the scoring run, so the `IS NULL` guard only ever matches history.
UPDATE "applications" SET "grant_purpose" = 'This application was submitted before grant purposes were generated.' WHERE "grant_purpose" IS NULL;
