-- Data-preserving contract step (mirrors 0034 for reporting). Before dropping the
-- legacy `applications.reporting_schedule` jsonb, copy any milestones that haven't
-- already been promoted into `grant_reports`. Idempotent via NOT EXISTS, so it is a
-- no-op where the backfill already ran (e.g. staging) and the single place prod's
-- existing reporting schedules get migrated (CI runs this before deploy).
INSERT INTO "grant_reports" ("grant_id", "label", "due_date")
SELECT g."id", elem->>'label', elem->>'date'
FROM "grants" g
JOIN "applications" a ON g."application_id" = a."id"
CROSS JOIN LATERAL jsonb_array_elements(a."reporting_schedule") elem
WHERE a."reporting_schedule" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "grant_reports" gr WHERE gr."grant_id" = g."id");
--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "reporting_schedule";
