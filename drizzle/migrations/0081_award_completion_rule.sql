-- An award's status is derived, and the rule it is derived from just changed: complete
-- used to mean "every instalment paid" and now means every instalment paid, every
-- reporting milestone received, and every report that actually arrived signed off.
-- See src/lib/awardCompletion.ts.
--
-- Every non-cancelled award is re-derived rather than only the ones that must move, so
-- there is no legacy pocket left running on the old rule. That is two-directional on
-- purpose: grants marked complete on payment alone while reporting was still outstanding
-- drop back to active (the visible change, and the point of the exercise), and grants the
-- onboarding import recorded as active whose payments and reports were in fact all
-- finished are completed. Cancelled is a decision, not a derivation, and is not touched.
--
-- The report test mirrors `isArrivedReport` (src/server/reports/query.ts): an imported
-- impact figure answering no milestone is not a document anyone submitted, so it never
-- waits on a review that will never come.
UPDATE "awards" a
SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "award_instalments" i WHERE i."award_id" = a."id")
   AND NOT EXISTS (
     SELECT 1 FROM "award_instalments" i
     WHERE i."award_id" = a."id" AND i."paid_date" IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM "report_schedule" s
     WHERE s."award_id" = a."id" AND s."submitted_date" IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM "reports" r
     WHERE r."award_id" = a."id"
       AND r."reviewed_at" IS NULL
       AND (r."import_batch_id" IS NULL OR r."schedule_id" IS NOT NULL)
   )
  THEN 'completed'::award_status
  ELSE 'active'::award_status
END
WHERE a."status" <> 'cancelled';
