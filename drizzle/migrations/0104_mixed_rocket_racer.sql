ALTER TABLE "annual_budget_lines" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "annual_budget_lines" ADD COLUMN "fixed" boolean;--> statement-breakpoint
-- Every row before income existed: a programme line is a grant, anything else a cost.
UPDATE "annual_budget_lines" SET "kind" = CASE WHEN "programme_id" IS NULL THEN 'cost' ELSE 'grant' END WHERE "kind" IS NULL;
