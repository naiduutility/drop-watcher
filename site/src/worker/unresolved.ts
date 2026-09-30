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
    await db.update(targets).set({
      lastCheckedAt: now,
      lastOkAt: conclusive ? now : target.lastOkAt,
      consecutiveInconclusive: failures,
      nextDueAt: nextDueAt({
        priority: target.priority as Priority, consecutiveInconclusive: failures, now,
      }),
    }).where(eq(targets.id, target.id));
    return null;
  }

  console.log(`   booking is OPEN - proving a code from ${read.candidates.length} candidate(s)`);
  const { bookCode, tried } = await resolveBookCode(
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
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.targetId, target.id), eq(subscriptions.showDate, "*")));

  return {
    targetId: target.id,
    title: target.title,
    city: target.city,
    bookCode,
    userIds: [...new Set(waiting.map((w) => w.userId))],
  };
}
