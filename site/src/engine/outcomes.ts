/**
 * What one read of a showtimes page concluded.
 *
 * Every bug this watcher has ever had was the same shape: BookMyShow answered
 * a question we did not ask, at HTTP 200, and the code read that answer as if
 * it were the one it wanted.
 *
 *   wrong booking code -> 200, zero venues        -> looked like "not open yet"
 *   date with no shows -> 200, ANOTHER DAY'S data -> looked like "on sale!"
 *   Cloudflare wall    -> 403, 691 bytes          -> looked like a scrape failure
 *   stale parser       -> 200, unrecognised shape -> looked like "no venues"
 *
 * So a read no longer returns a venue list. It returns an Outcome, and exactly
 * one Outcome is allowed to raise an alert. Everything else is recorded and
 * shown, never inferred from.
 */

import {
  looksBlocked,
  looksLikePageError,
  offeredDates,
  parseVenues,
  servedDate,
  venueKeyCount,
  type Venue,
} from "./parse.js";

export const Outcome = {
  // Conclusive: BMS answered the question we asked.
  OK_SHOWS: "ok_shows",           // the ONLY outcome that may alert
  OK_EMPTY: "ok_empty",           // right date, genuinely no venues
  DATE_FALLBACK: "date_fallback", // our date isn't on sale; BMS served another

  // Inconclusive: we learned nothing about the date we asked about.
  BLOCKED: "blocked",             // anti-bot wall — interpret NOTHING
  PAGE_ERROR: "page_error",       // BMS's own "Oops" screen
  UNPARSEABLE: "unparseable",     // 200, but the shape moved under us
  BAD_CODE: "bad_code",           // no venues and no dates: wrong book_code?
} as const;

export type Outcome = (typeof Outcome)[keyof typeof Outcome];

const CONCLUSIVE: Outcome[] = [
  Outcome.OK_SHOWS, Outcome.OK_EMPTY, Outcome.DATE_FALLBACK,
];

export interface Reading {
  outcome: Outcome;
  requestedDate: string | null;
  servedDate: string | null;
  offeredDates: string[];
  venues: Venue[];
  detail: string;
}

/** Only a confirmed right-date-with-shows read may notify anybody. */
export function mayAlert(r: Reading): boolean {
  return r.outcome === Outcome.OK_SHOWS;
}

/**
 * Did we actually learn the answer? Drives backoff and the dead-man's switch:
 * a run of inconclusive reads means the watch is degraded, which the user must
 * be TOLD, because silence otherwise looks exactly like "nothing on sale yet".
 */
export function isConclusive(r: Reading): boolean {
  return CONCLUSIVE.includes(r.outcome);
}

export interface ReadOptions {
  bodyText?: string;
  /** YYYYMMDD the URL asked for. Omitting it means "whatever BMS gives",
   *  and no date verification is possible. */
  requestedDate?: string | null;
  httpStatus?: number;
}

export function readShowtimes(html: string, opts: ReadOptions = {}): Reading {
  const { bodyText = "", requestedDate = null, httpStatus = 200 } = opts;
  const base = { requestedDate, servedDate: null, offeredDates: [], venues: [] };
  const r = (outcome: Outcome, extra: Partial<Reading> = {}): Reading =>
    ({ ...base, detail: "", ...extra, outcome, requestedDate });

  // Block markers are searched in the RENDERED body text only, never in the
  // raw HTML. A perfectly healthy BMS page embeds its own request headers,
  // which include "cdn-loop":"cloudflare; loops=1" — so scanning the HTML
  // flags every good page as an anti-bot wall, turning a working watch into a
  // permanently "degraded" one. Caught by the captured fixture in the tests.
  if (httpStatus >= 400) return r(Outcome.BLOCKED, { detail: `HTTP ${httpStatus}` });
  if (looksBlocked(bodyText)) {
    return r(Outcome.BLOCKED, { detail: "anti-bot markers in the rendered page" });
  }
  // A real showtimes page renders thousands of characters of chrome alone; a
  // challenge interstitial was 691. Only applied when body text was actually
  // captured, so an html-only caller is not blanket-rejected.
  if (bodyText && bodyText.length < 500) {
    return r(Outcome.BLOCKED, { detail: `rendered body only ${bodyText.length} chars` });
  }
  if (looksLikePageError(bodyText)) {
    return r(Outcome.PAGE_ERROR, { detail: "BMS served its own error page" });
  }

  const served = servedDate(html);
  const offered = offeredDates(html);
  const venues = parseVenues(html);

  // No date markers at all: either a wrong code (nothing on the page) or a
  // shape change (venues present but undateable). Never guess which.
  if (!served && offered.length === 0) {
    if (venues.length === 0 && venueKeyCount(html) === 0) {
      return r(Outcome.BAD_CODE, {
        detail: "no venues and no date strip - wrong booking code?",
      });
    }
    return r(Outcome.UNPARSEABLE, {
      venues,
      detail: "venues found but no showDate/dateCode to date them",
    });
  }

  if (requestedDate) {
    if (served && served !== requestedDate) {
      return r(Outcome.DATE_FALLBACK, {
        servedDate: served, offeredDates: offered,
        detail: `asked ${requestedDate}, BMS served ${served}`,
      });
    }
    if (!served && !offered.includes(requestedDate)) {
      return r(Outcome.DATE_FALLBACK, {
        offeredDates: offered,
        detail: `${requestedDate} absent from the date strip`,
      });
    }
  }

  if (venues.length === 0) {
    return r(Outcome.OK_EMPTY, {
      servedDate: served, offeredDates: offered,
      detail: "right date, no venues listed",
    });
  }
  return r(Outcome.OK_SHOWS, {
    servedDate: served, offeredDates: offered, venues,
    detail: `${venues.length} venue(s)`,
  });
}
