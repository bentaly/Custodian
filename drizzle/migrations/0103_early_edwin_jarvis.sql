ALTER TABLE "reports" DROP COLUMN "amount_awarded";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "award_date";--> statement-breakpoint
-- Learned mappings to the two report fields that no longer exist (2026-09-29).
DELETE FROM "field_mappings" WHERE "form_type" = 'report' AND "canonical_field" IN ('amountAwarded', 'awardDate');
