CREATE INDEX "api_keys_client_idx" ON "api_keys" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "application_ingests_status_created_idx" ON "application_ingests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "invitations_client_idx" ON "invitations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "programmes_client_idx" ON "programmes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "report_ingests_status_created_idx" ON "report_ingests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_client_idx" ON "reports" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "rounds_client_idx" ON "rounds" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "users_client_role_idx" ON "users" USING btree ("client_id","role");