-- Rename the award vocabulary so the schema matches the domain language:
--   grants             -> awards             (the funding decision + total)
--   grant_payments     -> award_instalments  (dated amounts, ticked when paid)
--   grant_reports      -> report_schedule    (dated expectations, ticked when met)
--   report_submissions -> reports            (the documents charities actually send)
-- Written by hand rather than via `drizzle-kit generate` so every change is an
-- ALTER ... RENAME (data-preserving) and never a drop + recreate.
--
-- Also tightens two columns that were nullable for cases we no longer support:
-- an award always comes from an application, and an expected report always has a date.

--> statement-breakpoint
ALTER TYPE "public"."grant_status" RENAME TO "award_status";--> statement-breakpoint

ALTER TABLE "grants" RENAME TO "awards";--> statement-breakpoint
ALTER TABLE "grant_payments" RENAME TO "award_instalments";--> statement-breakpoint
ALTER TABLE "grant_reports" RENAME TO "report_schedule";--> statement-breakpoint
ALTER TABLE "report_submissions" RENAME TO "reports";--> statement-breakpoint

ALTER TABLE "award_instalments" RENAME COLUMN "grant_id" TO "award_id";--> statement-breakpoint
ALTER TABLE "report_schedule" RENAME COLUMN "grant_id" TO "award_id";--> statement-breakpoint
ALTER TABLE "reports" RENAME COLUMN "grant_id" TO "award_id";--> statement-breakpoint
ALTER TABLE "reports" RENAME COLUMN "grant_report_id" TO "schedule_id";--> statement-breakpoint
ALTER TABLE "report_ingests" RENAME COLUMN "report_submission_id" TO "report_id";--> statement-breakpoint

-- Postgres keeps the original constraint names through a table/column rename; rename
-- them too so a future `drizzle-kit generate` sees no drift and emits no churn.
ALTER TABLE "awards" RENAME CONSTRAINT "grants_application_id_applications_id_fk" TO "awards_application_id_applications_id_fk";--> statement-breakpoint
ALTER TABLE "awards" RENAME CONSTRAINT "grants_client_id_clients_id_fk" TO "awards_client_id_clients_id_fk";--> statement-breakpoint
ALTER TABLE "award_instalments" RENAME CONSTRAINT "grant_payments_grant_id_grants_id_fk" TO "award_instalments_award_id_awards_id_fk";--> statement-breakpoint
ALTER TABLE "report_schedule" RENAME CONSTRAINT "grant_reports_grant_id_grants_id_fk" TO "report_schedule_award_id_awards_id_fk";--> statement-breakpoint
ALTER TABLE "reports" RENAME CONSTRAINT "report_submissions_client_id_clients_id_fk" TO "reports_client_id_clients_id_fk";--> statement-breakpoint
ALTER TABLE "reports" RENAME CONSTRAINT "report_submissions_grant_id_grants_id_fk" TO "reports_award_id_awards_id_fk";--> statement-breakpoint
ALTER TABLE "reports" RENAME CONSTRAINT "report_submissions_grant_report_id_grant_reports_id_fk" TO "reports_schedule_id_report_schedule_id_fk";--> statement-breakpoint
ALTER TABLE "report_ingests" RENAME CONSTRAINT "report_ingests_report_submission_id_report_submissions_id_fk" TO "report_ingests_report_id_reports_id_fk";--> statement-breakpoint

-- `matchCandidates` is advisory JSON written by the matching heuristics; its objects
-- carry a `grantId` key that the application code now reads as `awardId`.
UPDATE "report_ingests"
SET "match_candidates" = (
  SELECT jsonb_agg(c - 'grantId' || jsonb_build_object('awardId', c->'grantId'))
  FROM jsonb_array_elements("match_candidates") AS c
)
WHERE "match_candidates" IS NOT NULL
  AND jsonb_typeof("match_candidates") = 'array'
  AND jsonb_array_length("match_candidates") > 0;--> statement-breakpoint

-- An expected report always has a date. The award form never allowed a dateless row
-- (it silently dropped them), so this should be a no-op on real data — if it fails,
-- a row got in some other way and wants looking at before this ships.
ALTER TABLE "report_schedule" ALTER COLUMN "due_date" SET NOT NULL;--> statement-breakpoint

-- Every award is generated from an application. The nullable "direct grant" case (a
-- family office recording money given with no intake) was never built.
ALTER TABLE "awards" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint

-- ON DELETE set null -> restrict: with `application_id` NOT NULL, set null is no longer
-- possible. `restrict` mirrors the guard the admin ingest-delete route already applies
-- (409 "Application has an awarded grant and cannot be deleted") rather than cascading
-- and silently taking the instalments and reports with it.
ALTER TABLE "awards" DROP CONSTRAINT "awards_application_id_applications_id_fk";--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;
