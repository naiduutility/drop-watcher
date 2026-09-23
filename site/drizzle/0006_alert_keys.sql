-- Per-screen, per-day acknowledgement.
--
-- A date goes on sale one cinema at a time. With a single ack per date, the
-- first multiplex to list decided whether you ever heard about PCX at Prasads
-- — the screen the watch was built for. check.py acknowledged per theatre per
-- day; this restores it at theatre AND screen.
--
-- notified_keys: what we have already announced, so a second cinema opening an
-- hour later is news rather than a repeat of the first.
-- acked_keys: what the person has silenced, which is narrower than silencing
-- the whole watch and is reversible one key at a time.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "notified_keys" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "acked_keys" text[] DEFAULT '{}' NOT NULL;

-- A watch that has already fired has, in the old model, been told about the
-- whole date. Record that so it is not announced a second time.
UPDATE "subscriptions" SET "notified_keys" = ARRAY['*'] WHERE "state" = 'fired';
UPDATE "subscriptions" SET "acked_keys" = ARRAY['*'] WHERE "state" = 'acked';
