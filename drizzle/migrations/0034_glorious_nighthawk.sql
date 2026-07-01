-- Data-preserving contract step. Before dropping the legacy award columns from
-- `applications`, copy any award that hasn't already been promoted into the new
-- `grants` / `grant_payments` tables. Idempotent via NOT EXISTS, so it is a no-op
-- where the backfill already ran (e.g. staging, via scripts/backfill-grants.ts) and
-- the single place prod's existing awards get migrated (CI runs this before deploy).
INSERT INTO "grants" ("application_id", "client_id", "amount_awarded", "status", "decision_at")
SELECT a."id", p."client_id", a."amount_awarded", 'active', COALESCE(a."decision_at", now())
FROM "applications" a
JOIN "round_programmes" rp ON a."round_programme_id" = rp."id"
JOIN "programmes" p ON rp."programme_id" = p."id"
WHERE a."status" = 'awarded'
  AND a."amount_awarded" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "grants" g WHERE g."application_id" = a."id");
--> statement-breakpoint
INSERT INTO "grant_payments" ("grant_id", "instalment_no", "amount", "due_date")
SELECT g."id", (elem->>'instalment')::int, (elem->>'amount')::numeric, elem->>'date'
FROM "grants" g
JOIN "applications" a ON g."application_id" = a."id"
CROSS JOIN LATERAL jsonb_array_elements(a."payment_schedule") elem
WHERE a."payment_schedule" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "grant_payments" gp WHERE gp."grant_id" = g."id");
--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "amount_awarded";--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "payment_schedule";
