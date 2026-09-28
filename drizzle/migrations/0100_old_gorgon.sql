ALTER TYPE "public"."audit_action" ADD VALUE 'report_attached' BEFORE 'assessment_rerun';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'report_moved' BEFORE 'assessment_rerun';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'report_impact_changed' BEFORE 'assessment_rerun';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'report_analysis_rerun' BEFORE 'assessment_rerun';--> statement-breakpoint
ALTER TYPE "public"."report_analysis_status" ADD VALUE 'queued';--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "impact_summary" DROP NOT NULL;