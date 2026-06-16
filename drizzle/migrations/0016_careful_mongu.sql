-- Backfill any existing round_programme rows that pre-date the budget requirement
UPDATE "round_programmes" SET
  "budget" = '250000',
  "max_grant_amount" = '25000',
  "grant_duration_years" = 3
WHERE "budget" IS NULL;

ALTER TABLE "round_programmes" ALTER COLUMN "budget" SET NOT NULL;
