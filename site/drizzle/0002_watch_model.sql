-- The watch model, as the UI designs assume it.
--
-- A watch becomes ONE row per person, film and date, carrying optional cinema
-- and screen filters, instead of a separate subscription per cinema. That is
-- what lets the app say "you already watch this date" rather than quietly
-- creating a near-duplicate, and it makes "no cinema picked" the natural
-- default rather than a special case.
--
-- An empty cinema_codes means EVERY cinema. A premiere has no venue list to
-- choose from when the watch is made, so any model that required a choice
-- would be useless in the case this product exists for.

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "venue_entry";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "screen_entry";
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cinema_codes" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "screen_filter" text;

-- Collapse duplicates left by the old model, which allowed one row per
-- cinema. Keeping the earliest of each group: the later rows were narrowings
-- of the same intent, and an empty cinema_codes (every cinema) is the safer
-- survivor than an arbitrary narrowing.
DELETE FROM "subscriptions" a
USING "subscriptions" b
WHERE a."user_id" = b."user_id"
  AND a."target_id" = b."target_id"
  AND a."show_date" = b."show_date"
  AND (a."created_at" > b."created_at"
       OR (a."created_at" = b."created_at" AND a."id" > b."id"));

DROP INDEX IF EXISTS "subscriptions_once";
CREATE UNIQUE INDEX "subscriptions_once"
  ON "subscriptions" ("user_id", "target_id", "show_date");

-- Exactly one person sees the invites screen; everyone else gets a 404.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_owner" boolean DEFAULT false NOT NULL;

-- Pairing a second device. Stored rather than a stateless signed token,
-- because "this link has already been used" is a state the UI promises to
-- show and a signature alone cannot know it.
CREATE TABLE IF NOT EXISTS "device_links" (
  "code" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
