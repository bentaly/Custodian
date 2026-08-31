CREATE TABLE "annual_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"programme_id" uuid,
	"label" text,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annual_budget_lines_programme_uniq" UNIQUE("budget_id","programme_id")
);
--> statement-breakpoint
CREATE TABLE "annual_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"financial_year_start" text NOT NULL,
	"financial_year_end" text NOT NULL,
	"label" text NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annual_budgets_client_year_uniq" UNIQUE("client_id","financial_year_start")
);
--> statement-breakpoint
CREATE TABLE "bank_balance_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"as_at_date" text NOT NULL,
	"note" text,
	"recorded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "financial_year_end_month" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "annual_budget_lines" ADD CONSTRAINT "annual_budget_lines_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_budget_lines" ADD CONSTRAINT "annual_budget_lines_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_budgets" ADD CONSTRAINT "annual_budgets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_budgets" ADD CONSTRAINT "annual_budgets_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_balance_readings" ADD CONSTRAINT "bank_balance_readings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_balance_readings" ADD CONSTRAINT "bank_balance_readings_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annual_budget_lines_budget_idx" ON "annual_budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "bank_balance_readings_client_date_idx" ON "bank_balance_readings" USING btree ("client_id","as_at_date","created_at");