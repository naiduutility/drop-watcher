CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"screens" text[] DEFAULT '{}' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "venues_identity" ON "venues" USING btree ("city","code");--> statement-breakpoint
CREATE INDEX "venues_by_city" ON "venues" USING btree ("city","name");