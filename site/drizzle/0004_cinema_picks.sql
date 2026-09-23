-- Screens belong to a cinema, not to the watch.
--
-- What people actually want is one particular auditorium: PCX at Prasads, HDR
-- By Barco at AMB, Dolby Cinema at Allu Cinemas. A single watch-wide format
-- filter cannot express that — "Prasads + AMB, Dolby" would also fire for
-- Dolby at Prasads, which is not what was asked for. check.py could express
-- it; the rewrite lost it.
--
-- Existing rows carry their codes across with no screen narrowing, which is
-- the safer reading: every screen at the cinemas they chose.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "cinema_picks" jsonb DEFAULT '[]'::jsonb NOT NULL;

UPDATE "subscriptions" SET "cinema_picks" = (
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', c, 'screens', '[]'::jsonb)), '[]'::jsonb)
  FROM unnest("cinema_codes") AS c
)
WHERE array_length("cinema_codes", 1) > 0;

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "cinema_codes";
