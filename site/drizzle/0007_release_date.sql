-- The advertised release date, so an unreleased film checks itself more often
-- as that date approaches. A film in December does not need looking at every
-- five minutes; the same film three days out does.
ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "release_date" text;
