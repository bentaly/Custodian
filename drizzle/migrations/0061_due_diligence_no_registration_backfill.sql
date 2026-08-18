-- Applications already screened as `review` purely because they carried neither a
-- charity number nor a company number. `review` means "a check was attempted and a
-- person must finish it", so these sat in the dashboard's due-diligence flag count
-- with nothing anybody could do: re-running reads the same two empty columns.
--
-- `no_registration` says what is actually true, and the application screen offers the
-- only fix (add a number, which screens on the spot). Rows at `review` that DO hold a
-- number are left alone — those are genuine register errors awaiting a retry.
--
-- Separate from 0060, which adds the enum value: Postgres refuses a new enum value in
-- the transaction that created it.
UPDATE "applications"
SET "due_diligence_status" = 'no_registration'
WHERE "due_diligence_status" = 'review'
  AND "charity_number" IS NULL
  AND "company_number" IS NULL;
