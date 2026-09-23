-- Several formats, not one.
--
-- A premium screen goes by different names across a city, and wanting IMAX
-- *or* Dolby Cinema is a single intent rather than a reason to keep two
-- watches. Screens per cinema were already a list; this makes the any-cinema
-- filter match.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "screen_filters" text[] DEFAULT '{}' NOT NULL;

UPDATE "subscriptions"
  SET "screen_filters" = ARRAY["screen_filter"]
  WHERE "screen_filter" IS NOT NULL AND "screen_filter" <> '';

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "screen_filter";
