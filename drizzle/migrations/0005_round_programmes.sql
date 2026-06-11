-- Add client_id (nullable for backfill) --> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "client_id" uuid;--> statement-breakpoint

-- Backfill client_id from the linked round --> statement-breakpoint
UPDATE "programmes" SET "client_id" = (
  SELECT "client_id" FROM "rounds" WHERE "rounds"."id" = "programmes"."round_id"
);--> statement-breakpoint

-- Enforce NOT NULL now that data is present --> statement-breakpoint
ALTER TABLE "programmes" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Create the join table --> statement-breakpoint
CREATE TABLE "round_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "round_programmes_uniq" UNIQUE("round_id","programme_id")
);--> statement-breakpoint

-- Backfill existing round–programme relationships --> statement-breakpoint
INSERT INTO "round_programmes" ("id", "round_id", "programme_id", "created_at")
  SELECT gen_random_uuid(), "round_id", "id", "created_at"
  FROM "programmes";--> statement-breakpoint

ALTER TABLE "round_programmes" ADD CONSTRAINT "round_programmes_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_programmes" ADD CONSTRAINT "round_programmes_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Drop old round_id FK and column --> statement-breakpoint
ALTER TABLE "programmes" DROP CONSTRAINT "programmes_round_id_rounds_id_fk";--> statement-breakpoint
ALTER TABLE "programmes" DROP COLUMN "round_id";
