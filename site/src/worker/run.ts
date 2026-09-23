/**
 * One pass of the due queue.
 *
 * Deliberately a one-shot rather than a daemon: the same entry point runs on
 * GitHub Actions cron, on a laptop with a residential IP, or anywhere else,
 * and two of them running at once is safe because due targets are claimed with
 * SKIP LOCKED. Whichever machine is available does the work.
 *
 * The shape of a pass:
 *   claim due targets -> plan the fewest fetches -> read -> record EVERY
 *   outcome -> emit events -> reschedule.
 *
 * Every step records what it saw, including the steps that learned nothing.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { channels, checks, notifications, subscriptions, targets } from "../db/schema.js";
import { isConclusive, showtimesUrl, type Reading } from "../engine/index.js";
import { nextDueAt, planFetches, type Priority } from "../core/schedule.js";
import {
  DEFAULT_POLICY, planEvents, type SubscriptionView, type WatchEvent,
} from "../core/transitions.js";
import { channelFor, type OutboundMessage } from "../notify/index.js";
import { rememberVenues } from "../lib/venues.js";
import { browserProvider, fetchShowtimes, sleep, PACING_MS } from "./fetch.js";
import { envBaseUrl, envNumber } from "../lib/env.js";

const BATCH = envNumber("WORKER_BATCH", 8);
const APP_URL = envBaseUrl("APP_URL", "http://localhost:3000");

function prettyDate(yyyymmdd: string): string {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)),
  );
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

/**
 * Claim targets that are due.
 *
 * FOR UPDATE SKIP LOCKED so a second worker — the laptop waking up while
 * Actions is mid-run — takes different rows instead of duplicating requests at
 * an IP that is already being rate limited.
 */
async function claimDue(now: Date) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(targets)
      .where(and(eq(targets.status, "active"), lte(targets.nextDueAt, now)))
      .orderBy(targets.nextDueAt)
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (due.length > 0) {
      // Push them out immediately so a crash mid-pass cannot leave a target
      // spinning at the front of the queue.
      await tx
        .update(targets)
        .set({ nextDueAt: new Date(now.getTime() + 60_000) })
        .where(inArray(targets.id, due.map((t) => t.id)));
    }
    return due;
  });
}

function messageFor(
  event: WatchEvent, title: string, city: string, bookingUrl: string, venuesLine: string,
): OutboundMessage | null {
  if (event.kind === "degraded") {
    const age = event.minutesSinceOk === null
      ? "since it was created"
      : `for ${event.minutesSinceOk} minutes`;
    return {
      title: `${title}: watch is not reading BookMyShow`,
      body:
        `We have not managed a clean read ${age}, so we cannot tell you ` +
        `whether tickets are out. This is us failing, not a quiet box office.\n\n` +
        `Details: ${APP_URL}/targets/${event.targetId}`,
      clickUrl: `${APP_URL}/targets/${event.targetId}`,
      priority: "normal",
    };
  }
  const when = prettyDate(event.showDate);
  const first = event.kind === "on_sale";
  return {
    title: first
      ? `${title}: shows are UP for ${when}!`
      : `${title}: still on sale for ${when}`,
    body:
      `${first ? "Shows just appeared" : "Reminder - shows are listed"} for ` +
      `${when} in ${city}.\n${bookingUrl}${venuesLine}`,
    clickUrl: bookingUrl,
    priority: "high",
    // Links into our app: idempotent, state-aware, and undoable. Nothing here
    // can be tapped from a stale notification to destroy a watch.
    actions: [
      { label: "Book now", url: bookingUrl },
      { label: "Got it", url: `${APP_URL}/s/${event.subscriptionId}/ack` },
    ],
  };
}

/**
 * Returns true only if at least one channel ACCEPTED the message.
 *
 * The caller uses that to decide whether the alert counts as sent. Marking a
 * subscription "fired" on a failed publish is the quietest possible way to
 * lose an alert: the person is never told, and the database says they were.
 */
async function deliver(
  event: WatchEvent, message: OutboundMessage, userIds: string[],
): Promise<boolean> {
  const rows = await db
    .select()
    .from(channels)
    .where(and(inArray(channels.userId, userIds), eq(channels.active, true)));

  if (rows.length === 0) {
    console.error("!! nobody has a notification channel - alert has nowhere to go");
    return false;
  }

  let anyDelivered = false;
  for (const row of rows) {
    const result = await channelFor(row).send(message);
    if (result.ok) anyDelivered = true;
    await db.insert(notifications).values({
      subscriptionId: event.kind === "degraded" ? null : event.subscriptionId,
      channelId: row.id,
      event: event.kind === "on_sale" ? "on_sale"
        : event.kind === "reminder" ? "reminder" : "degraded",
      title: message.title,
      body: message.body,
      ok: result.ok,
      error: result.error ?? null,
    });
    if (!result.ok) {
      // Loud: an undelivered alert is the entire job failing, and a silent
      // failure here is indistinguishable from "nothing happened yet".
      console.error(`!! delivery failed on ${row.kind}: ${result.error}`);
    }
  }
  return anyDelivered;
}

async function applyEvents(events: WatchEvent[], now: Date) {
  for (const event of events) {
    if (event.kind === "on_sale") {
      await db.update(subscriptions)
        .set({ state: "fired", firedAt: now })
        .where(eq(subscriptions.id, event.subscriptionId));
    } else if (event.kind === "reminder") {
      await db.update(subscriptions)
        .set({ remindersSent: sql`${subscriptions.remindersSent} + 1` })
        .where(eq(subscriptions.id, event.subscriptionId));
    } else {
      await db.update(targets)
        .set({ degradedNotifiedAt: now })
        .where(eq(targets.id, event.targetId));
    }
  }
}

export async function runPass(now = new Date()): Promise<void> {
  const due = await claimDue(now);
  if (due.length === 0) {
    console.log("nothing due");
    return;
  }
  console.log(`claimed ${due.length} target(s)`);

  // No browser is started unless curl is actually refused. A pass that never
  // escalates never pays for Playwright at all.
  const { provider, close } = await browserProvider();
  try {
    for (const target of due) {
      const subs = await db.select().from(subscriptions)
        .where(and(eq(subscriptions.targetId, target.id),
                   inArray(subscriptions.state, ["armed", "fired"])));
      const views: SubscriptionView[] = subs.map((s) => ({
        id: s.id, userId: s.userId, showDate: s.showDate, kind: s.kind,
        venueEntry: s.venueEntry, screenEntry: s.screenEntry,
        state: s.state, firedAt: s.firedAt, remindersSent: s.remindersSent,
      }));

      const armedDates = views.filter((s) => s.state === "armed").map((s) => s.showDate);
      // A subscription that has fired but not been acked still owes a nudge,
      // and a nudge needs a fresh read to be honest about. Only dates whose
      // reminder is actually DUE are added, so an unacked alert does not
      // quietly restore per-pass polling for everyone who never taps "Got it".
      const reminderDue = views
        .filter((s) =>
          s.state === "fired" &&
          s.remindersSent < DEFAULT_POLICY.maxReminders &&
          s.firedAt !== null &&
          now.getTime() - s.firedAt.getTime() >= DEFAULT_POLICY.reminderAfterMs)
        .map((s) => s.showDate);
      const plan = planFetches({
        armedDates: [...armedDates, ...reminderDue],
        offeredDates: target.offeredDates,
      });
      console.log(`\n==== ${target.title} (${target.city}) ====`);
      console.log(`   armed dates: ${armedDates.join(", ") || "none"}`);
      console.log(`   fetching   : ${plan.join(", ") || "nothing"}`);

      let lastReading: Reading | null = null;
      {
        for (const [i, date] of plan.entries()) {
          if (i > 0) await sleep(PACING_MS);
          const url = showtimesUrl(target.movieUrl, date, {
            bookCode: target.bookCode, language: target.language,
          });
          const { reading, durationMs, httpStatus, transport } =
            await fetchShowtimes(url, date, provider);
          lastReading = reading;
          console.log(`   [${date}] ${reading.outcome} via ${transport} (${durationMs}ms) - ${reading.detail}`);

          await db.insert(checks).values({
            targetId: target.id, requestedDate: date,
            servedDate: reading.servedDate, outcome: reading.outcome,
            httpStatus, venueCount: reading.venues.length,
            durationMs, detail: reading.detail,
          });

          const delivered: WatchEvent[] = [];
          const events = planEvents({
            target: {
              id: target.id, title: target.title, city: target.city,
              lastOkAt: target.lastOkAt, degradedNotifiedAt: target.degradedNotifiedAt,
              createdAt: target.createdAt,
            },
            subscriptions: views, reading, now,
          });
          for (const event of events) {
            const bookingUrl = showtimesUrl(target.movieUrl, date, {
              bookCode: target.bookCode, language: target.language,
            });
            const venuesLine = reading.venues.length
              ? "\n\n" + reading.venues.slice(0, 12).map((v) => `  - ${v.name}`).join("\n")
              : "";
            const message = messageFor(event, target.title, target.city, bookingUrl, venuesLine);
            if (!message) continue;
            const userIds = event.kind === "degraded" ? event.userIds : [event.userId];
            console.log(`   -> ${event.kind} to ${userIds.length} user(s)`);
            if (await deliver(event, message, userIds)) {
              delivered.push(event);
            } else {
              // Left in its current state on purpose, so the next pass tries
              // again. An alert nobody received must never be recorded as one
              // they did.
              console.error(`!! ${event.kind} NOT delivered - left armed to retry`);
            }
          }
          // Only what actually reached somebody changes state.
          await applyEvents(delivered, now);

          // Every venue this read saw goes into the city catalogue. Free:
          // the payload was fetched to answer a different question, and the
          // venue list came along with it.
          if (reading.venues.length > 0) {
            const n = await rememberVenues(target.city, [...reading.venues]);
            console.log(`   catalogued ${n} venue(s) for ${target.city}`);
          }

          // The strip is refreshed by any successful read, which is why the
          // plan only ever has to spend one guaranteed request.
          if (reading.offeredDates.length > 0) {
            await db.update(targets)
              .set({ offeredDates: reading.offeredDates })
              .where(eq(targets.id, target.id));
          }
        }
      }

      // A pass that deliberately fetched nothing — everyone already told, no
      // reminder due — learned nothing and failed at nothing. Counting it as
      // an inconclusive read would back the target off and, once someone new
      // subscribed, make it look degraded when it was simply idle.
      const conclusive = lastReading ? isConclusive(lastReading) : false;
      const failures = plan.length === 0
        ? target.consecutiveInconclusive
        : conclusive ? 0 : target.consecutiveInconclusive + 1;
      await db.update(targets).set({
        lastOutcome: lastReading?.outcome ?? target.lastOutcome,
        lastCheckedAt: now,
        lastOkAt: conclusive ? now : target.lastOkAt,
        consecutiveInconclusive: failures,
        nextDueAt: nextDueAt({
          priority: target.priority as Priority,
          consecutiveInconclusive: failures,
          now,
        }),
      }).where(eq(targets.id, target.id));
    }
  } finally {
    await close();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  runPass()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
