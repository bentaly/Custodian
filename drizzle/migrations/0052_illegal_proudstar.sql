CREATE INDEX "application_comments_application_idx" ON "application_comments" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applications_scope_status_idx" ON "applications" USING btree ("round_programme_id","status");--> statement-breakpoint
CREATE INDEX "applications_scope_submitted_idx" ON "applications" USING btree ("round_programme_id","submitted_at");--> statement-breakpoint
CREATE INDEX "applications_external_id_idx" ON "applications" USING btree ("external_application_id");--> statement-breakpoint
CREATE INDEX "award_instalments_award_idx" ON "award_instalments" USING btree ("award_id");--> statement-breakpoint
CREATE INDEX "awards_client_decision_idx" ON "awards" USING btree ("client_id","decision_at");--> statement-breakpoint
CREATE INDEX "report_schedule_award_idx" ON "report_schedule" USING btree ("award_id");--> statement-breakpoint
CREATE INDEX "reports_award_idx" ON "reports" USING btree ("award_id");--> statement-breakpoint
CREATE INDEX "round_programmes_programme_idx" ON "round_programmes" USING btree ("programme_id");