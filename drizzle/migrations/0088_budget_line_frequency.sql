ALTER TABLE "annual_budget_lines" ADD COLUMN "frequency" text;--> statement-breakpoint
ALTER TABLE "annual_budget_lines" ADD COLUMN "due_date" text;--> statement-breakpoint
-- Every non-grant line written before this column spread evenly by assumption; say so.
UPDATE "annual_budget_lines" SET "frequency" = 'monthly' WHERE "programme_id" IS NULL;
