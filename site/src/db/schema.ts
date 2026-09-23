/**
 * The database is the contract between the website and the worker.
 *
 * Two shapes here exist because of specific failures on 2026-09-22, and are
 * worth understanding before changing anything:
 *
 * 1. A `target` is (city, bookCode, language) — NOT (city, movie, date). Twelve
 *    people watching the same premiere is ONE scrape, twelve notifications.
 *    Dates live on subscriptions. This is what makes the cost O(distinct
 *    targets) instead of O(users), and it is the only reason a group tool can
 *    survive BookMyShow's rate limiting at all.
 *
 * 2. `checks` records every read with an explicit outcome, including the ones
 *    that learned nothing. Yesterday "no alert arrived" could mean tickets
 *    weren't out, the scrape was blocked, the booking code was wrong, or the
 *    watch had been silenced — and there was no way to tell them apart without
 *    forensic archaeology across an ntfy cache and a saved HTML file. Silence
 *    must be explainable.
 */

import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import type { Outcome } from "../engine/index.js";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** Shown to the group: "Ravi is watching this too". Collected at join. */
  displayName: text("display_name"),
  /** Owner-only screens (invites) 404 for everyone else. */
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Pairing a second device.
 *
 * There are no passwords, so a signed-in phone mints a short-lived code and
 * the new device redeems it. Stored rather than stateless because "this link
 * has already been used" is a state the UI promises to show, and a signed
 * token alone cannot know it.
 */
export const deviceLinks = pgTable("device_links", {
  code: text("code").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-use invites. `claimedBy` is set in the SAME transaction that creates
 * the user, so a second click on the same link loses the race cleanly instead
 * of minting a second account.
 */
export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  createdBy: uuid("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedBy: uuid("claimed_by").references(() => users.id),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Where one person's notifications go. Rows, not code branches — which is what
 * lets Web Push arrive later as a new `kind` rather than a rewrite.
 *
 * Per USER, never per group. A shared channel is what let one member's
 * "Booked - stop all" silence everybody yesterday.
 */
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"ntfy" | "webpush">().notNull(),
  /** ntfy: {topic}. webpush: {endpoint, keys:{p256dh, auth}}. */
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One thing worth scraping: a movie, in a city, under one booking code.
 *
 * `bookCode` is resolved and PROVEN at creation, never guessed. It is not
 * derivable from the movie page URL, and a wrong one returns HTTP 200 with
 * zero venues forever — a watch that looks healthy and can never fire.
 */
export const targets = pgTable("targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  city: text("city").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  movieUrl: text("movie_url").notNull(),
  /** The ET code in the movie page URL — the ack/display identity. */
  pageCode: text("page_code").notNull(),
  /** The ET code the /buytickets/ path needs. Often different. */
  bookCode: text("book_code").notNull(),
  language: text("language"),

  status: text("status").$type<"active" | "unresolved" | "retired">()
    .notNull().default("active"),
  /** Poll cadence class. A premiere expected tonight is "hot"; a release three
   *  weeks out is "cold". Set by the site, used by the scheduler. */
  priority: text("priority").$type<"hot" | "normal" | "cold">()
    .notNull().default("normal"),

  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull().defaultNow(),
  /** Drives exponential backoff AND the dead-man's switch. Reset by any
   *  conclusive read; incremented by BLOCKED / PAGE_ERROR / UNPARSEABLE. */
  consecutiveInconclusive: integer("consecutive_inconclusive").notNull().default(0),
  degradedNotifiedAt: timestamp("degraded_notified_at", { withTimezone: true }),

  lastOutcome: text("last_outcome").$type<Outcome>(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  /** Last CONCLUSIVE read. The gap between this and now is the honest answer
   *  to "is this watch actually working?". */
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  /** The date strip: every date BMS says has shows for this event. Cheap
   *  availability oracle — trustworthy only because bookCode is city-pinned. */
  offeredDates: text("offered_dates").array().notNull().default([]),

  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // The deduplication rule, enforced by the database rather than by hope.
  identity: uniqueIndex("targets_identity").on(t.city, t.bookCode, t.language),
  due: index("targets_due").on(t.nextDueAt),
}));

/**
 * One person's interest in one date of one target.
 *
 * `state` is per subscription, so an ack silences exactly one person's alert
 * about exactly one date. Nobody can silence anyone else, and every transition
 * is reversible — `ackedAt = null` re-arms it. That single property is the
 * whole difference from the ntfy-ack model, where an accidental tap was
 * permanent and re-applied from a 12-hour cache on every run.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  /** YYYYMMDD. The date this person actually cares about. */
  showDate: text("show_date").notNull(),
  /**
   * Optional narrowing, and optional is the load-bearing word: an empty list
   * means EVERY cinema in the city and the watch is fully armed either way.
   * A premiere has no venue list to choose from, so requiring a choice would
   * make the product useless in precisely the case it exists for.
   */
  cinemaCodes: text("cinema_codes").array().notNull().default([]),
  /** e.g. "IMAX". null = any screen. */
  screenFilter: text("screen_filter"),

  state: text("state").$type<"armed" | "fired" | "acked">().notNull().default("armed"),
  firedAt: timestamp("fired_at", { withTimezone: true }),
  remindersSent: integer("reminders_sent").notNull().default(0),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One watch per person, per film, per date. Cinema narrowing lives ON the
  // watch rather than making a second one, which is what lets the UI say
  // "you already watch this date" instead of quietly creating a duplicate.
  once: uniqueIndex("subscriptions_once").on(t.userId, t.targetId, t.showDate),
  byTarget: index("subscriptions_by_target").on(t.targetId, t.state),
}));

/**
 * Every read of a showtimes page, conclusive or not.
 *
 * This is the table that answers "why didn't I get an alert?" in one query
 * instead of a day of detective work.
 */
export const checks = pgTable("checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  requestedDate: text("requested_date"),
  /** What BMS actually served. A difference from requestedDate IS the finding. */
  servedDate: text("served_date"),
  outcome: text("outcome").$type<Outcome>().notNull(),
  httpStatus: integer("http_status"),
  venueCount: integer("venue_count"),
  durationMs: integer("duration_ms"),
  detail: text("detail"),
}, (t) => ({
  byTarget: index("checks_by_target").on(t.targetId, t.at),
}));

/**
 * A self-maintaining catalogue of each city's cinemas.
 *
 * Built entirely from reads we already make: every ok_shows payload carries the
 * full venue list for that city, so this costs no extra requests to BookMyShow
 * — which is the only reason it is affordable at all. It replaces the manual
 * `--venues` dump that had to be regenerated by hand.
 *
 * Two things it is honest about. The CODE is the identity, because BMS renames
 * venues ("Prasads" vs "Prasad's") but codes are stable. And `screens` is a
 * union of formats ever SEEN at that venue, not a fixed capability list: BMS
 * reports the formats a venue is running THIS movie on, so a cinema's IMAX
 * only appears once some watched film has played there in IMAX.
 */
export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  city: text("city").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  screens: text("screens").array().notNull().default([]),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  /** Lets a closed cinema age out of the picker instead of haunting it. */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identity: uniqueIndex("venues_identity").on(t.city, t.code),
  byCity: index("venues_by_city").on(t.city, t.name),
}));

/** What we actually sent, to whom, and whether it landed. */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
  event: text("event").$type<"on_sale" | "reminder" | "degraded">().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  ok: boolean("ok").notNull(),
  error: text("error"),
});

export type Target = typeof targets.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Check = typeof checks.$inferSelect;
