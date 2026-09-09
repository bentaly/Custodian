CREATE TYPE "public"."insight_analysis_status" AS ENUM('pending', 'analysed', 'error');--> statement-breakpoint
CREATE TABLE "insight_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "insight_analysis_status" NOT NULL,
	"summary" text,
	"figures_cited" jsonb,
	"brief" jsonb,
	"input_fingerprint" text NOT NULL,
	"detail" jsonb,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insight_analyses" ADD CONSTRAINT "insight_analyses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insight_analyses_client_generated_idx" ON "insight_analyses" USING btree ("client_id","generated_at");