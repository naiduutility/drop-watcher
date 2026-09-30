/**
 * One pass over the films that have not gone on sale yet.
 *
 * Cheaper and simpler than the main queue: read the film's own page, and if
 * the Book tickets CTA is live, prove a booking code and promote the target to
 * a normal watch. Until then there is nothing to alert about, because there
 * are no dates to be on sale.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { checks, subscriptions, targets } from "../db/schema.js";
import { MovieOutcome, Outcome, readMoviePage } from "../engine/index.js";
import { nextDueAt, type Priority } from "../core/schedule.js";
import { fetchPage, type ContextProvider } from "./fetch.js";
import { resolveBookCode } from "./resolve.js";

export interface OpenedFilm {
  targetId: string;
  title: string;
  city: string;
  bookCode: string;
  /** The date the waiting watches were moved onto, if we could tell. */
  showDate: string | null;
  userIds: string[];
}

/**
 * Check one unresolved target. Returns the film if it just opened.
 *
 * Recorded in `checks` like any other read, so "why has this never fired?"
 * has the same forensic answer for a pre-release watch as for a normal one.
 */
export async function checkUnresolved(
  target: typeof targets.$inferSelect,
  provider: ContextProvider | undefined,
  now: Date,
): Promise<OpenedFilm | null> {
  const { html, bodyText, httpStatus, durationMs } = await fetchPage(target.movieUrl, provider);
  const read = readMoviePage(html, { bodyText, httpStatus, pageCode: target.pageCode || null });

  console.log(`   film page: ${read.outcome} - ${read.detail}`);

  await db.insert(checks).values({
    targetId: target.id,
    requestedDate: null,
    servedDate: null,
    // Mapped onto the same vocabulary so one table answers both kinds of read.
    outcome: read.outcome === MovieOutcome.OPEN ? Outcome.OK_SHOWS
      : read.outcome === MovieOutcome.NOT_OPEN ? Outcome.OK_EMPTY
      : read.outcome === MovieOutcome.BLOCKED ? Outcome.BLOCKED
      : Outcome.UNPARSEABLE,
    httpStatus,
    venueCount: 0,
    durationMs,
    detail: read.detail,
  });

  const conclusive = read.outcome === MovieOutcome.OPEN || read.outcome === MovieOutcome.NOT_OPEN;
  const failures = conclusive ? 0 : target.consecutiveInconclusive + 1;

  if (read.outcome !== MovieOutcome.OPEN) {
    // The cadence is the person's choice and is never overridden here. The
    // release date is still recorded, but only so the watch can show it.
    const priority = target.priority as Priority;
    await db.update(targets).set({
      lastCheckedAt: now,
      lastOkAt: conclusive ? now : target.lastOkAt,
      consecutiveInconclusive: failures,
      releaseDate: read.releaseDate ?? target.releaseDate,
      nextDueAt: nextDueAt({ priority, consecutiveInconclusive: failures, now }),
    }).where(eq(targets.id, target.id));
    return null;
  }

  console.log(`   booking is OPEN - proving a code from ${read.candidates.length} candidate(s)`);
  const { bookCode, offeredDates, tried } = await resolveBookCode(
    target.movieUrl, read.candidates, target.language, provider, now,
  );
  console.log(`   tried: ${tried.map((t) => `${t.code}=${t.outcome}`).join(", ") || "none"}`);

  if (!bookCode) {
    // Open, but we cannot yet say where. Not a failure of the film — keep
    // checking rather than promoting a target that could never fire.
    await db.update(targets).set({
      lastCheckedAt: now,
      consecutiveInconclusive: target.consecutiveInconclusive + 1,
      nextDueAt: nextDueAt({
        priority: target.priority as Priority,
        consecutiveInconclusive: target.consecutiveInconclusive + 1, now,
      }),
    }).where(eq(targets.id, target.id));
    return null;
  }

  // The first day it can be booked. Earliest listed rather than the advertised
  // release date, because a premiere shows the night before release and that
  // is the one worth having.
  const firstDay = [...offeredDates].sort()[0]
    ?? read.releaseDate ?? target.releaseDate ?? null;

  await db.update(targets).set({
    bookCode,
    status: "active",
    priority: "hot",
    lastCheckedAt: now,
    lastOkAt: now,
    consecutiveInconclusive: 0,
    nextDueAt: now,
  }).where(eq(targets.id, target.id));

  const waiting = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.targetId, target.id), eq(subscriptions.showDate, "*")));

  // Move each waiting watch onto that first day, so nobody has to come back
  // and pick a date at six in the morning. If the same date is already
  // watched, the placeholder is simply dropped rather than duplicating it.
  if (firstDay) {
    for (const w of waiting) {
      const clash = await db.select({ id: subscriptions.id }).from(subscriptions)
        .where(and(
          eq(subscriptions.userId, w.userId),
          eq(subscriptions.targetId, target.id),
          eq(subscriptions.showDate, firstDay),
        )).limit(1);
      if (clash.length > 0) {
        await db.delete(subscriptions).where(eq(subscriptions.id, w.id));
      } else {
        await db.update(subscriptions)
          .set({ showDate: firstDay, state: "armed", notifiedKeys: [], ackedKeys: [] })
          .where(eq(subscriptions.id, w.id));
      }
    }
  }

  return {
    targetId: target.id,
    title: target.title,
    city: target.city,
    bookCode,
    showDate: firstDay,
    userIds: [...new Set(waiting.map((w) => w.userId))],
  };
}
