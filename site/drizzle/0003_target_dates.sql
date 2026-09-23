-- What was listed for one date, last time we read it cleanly.
-- The city catalogue says which cinemas exist; this says which are running
-- THIS film on THIS date — the only question someone with an on-sale watch
-- is actually asking. The data was already in a payload we fetched anyway.
CREATE TABLE IF NOT EXISTS "target_dates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE cascade,
  "show_date" text NOT NULL,
  "venue_count" integer DEFAULT 0 NOT NULL,
  "venues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "target_dates_identity"
  ON "target_dates" ("target_id", "show_date");
