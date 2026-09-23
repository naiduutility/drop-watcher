/**
 * Reading facts out of a BookMyShow showtimes payload.
 *
 * Everything is read from the page's embedded state, NOT the rendered DOM:
 * the venue list is virtualised, so scrolling only ever mounts a handful of
 * rows and scrolling past unmounts them all.
 */

/** Venue records in the embedded state: "venueCode":"PRHN" ... "venueName":"Prasads: Hyderabad" */
const VENUE_RE = /"venueCode":"([^"]+)"[^{}]*?"venueName":"([^"]+)"/;
/** One card per listed cinema. Splitting on this is what lets a screen be
 *  attributed to the venue running it — screens live in the showtime objects
 *  nested inside the card, not next to the venue name. */
const VENUE_CARD = '"type":"venue-card"';
/** `format` is the richer of the two: "Telugu • 2D | PCX SCREEN" against
 *  screenAttr's bare "PCX SCREEN". */
const SCREEN_ATTR_RE = /"screenAttr":"([^"]+)"/;
const SCREEN_FORMAT_RE = /"format":"([^"]*\u2022[^"]*)"/;

/** The date the payload is ACTUALLY for. */
const SHOW_DATE_RE = /"showDate"\s*:\s*"(\d{8})"/;
/** The date strip: every date that has shows for this event. */
const DATE_CODE_RE = /"dateCode"\s*:\s*"(\d{8})"/;

/**
 * Phrases meaning we hit an anti-bot wall rather than the real page. The
 * Cloudflare set was captured from a REAL 403 interstitial whose body was 691
 * chars and matched none of the original markers — it sailed through as a
 * harmless "not open yet", which is the failure that must never happen.
 */
export const BLOCK_MARKERS = [
  "access denied", "verify you are human", "are you a robot",
  "unusual traffic", "captcha", "request blocked", "you have been blocked",
  "attention required", "unable to access", "enable javascript and cookies",
  "cloudflare",
] as const;

/** BMS's own "we could not build this page" screen. Not a block and not an
 *  empty date — a third thing, and it must not be read as either. */
const PAGE_ERROR_MARKERS = ["oops! something went wrong", "please try refreshing"];

function allMatches(re: RegExp, text: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(re.source, re.flags + "g"))];
}

export function looksBlocked(bodyText: string | undefined | null): boolean {
  const low = (bodyText ?? "").toLowerCase();
  return BLOCK_MARKERS.some((m) => low.includes(m));
}

export function looksLikePageError(bodyText: string | undefined | null): boolean {
  const low = (bodyText ?? "").toLowerCase();
  return PAGE_ERROR_MARKERS.some((m) => low.includes(m));
}

/**
 * The date this payload was actually built for, or null.
 *
 * THE authority on which day you are looking at. Asked for a date with no
 * shows, BMS does not return an empty page — it serves the next date that HAS
 * them, at HTTP 200 with a full venue list.
 */
export function servedDate(html: string): string | null {
  return html.match(SHOW_DATE_RE)?.[1] ?? null;
}

/**
 * Every date in the payload's date strip, sorted.
 *
 * A weaker signal than servedDate and NOT a substitute for it: a national
 * event code lists a date because the show exists SOMEWHERE in the country,
 * while servedDate still says the payload built for your city is another day.
 * Trustworthy only once the city's own booking code is pinned.
 */
export function offeredDates(html: string): string[] {
  const found = allMatches(DATE_CODE_RE, html).map((m) => m[1]!);
  return [...new Set(found)].sort();
}

/** Unique screen formats inside one venue card, in payload order. */
export function parseScreens(segment: string): string[] {
  let labels = allMatches(SCREEN_FORMAT_RE, segment).map((m) => m[1]!);
  if (labels.length === 0) {
    labels = allMatches(SCREEN_ATTR_RE, segment).map((m) => m[1]!);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

export interface Venue {
  name: string;
  code: string;
  /** null — not [] — when the card layout could not be read at all. "We could
   *  not read this venue's screens" must never be reported as "this venue is
   *  not running your screen", or a payload change silences a screen watch. */
  screens: string[] | null;
}

export function parseVenues(html: string): Venue[] {
  const venues: Venue[] = [];
  const seen = new Set<string>();
  for (const segment of html.split(VENUE_CARD).slice(1)) {
    const m = segment.match(VENUE_RE);
    if (!m || seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    venues.push({ name: m[2]!, code: m[1]!, screens: parseScreens(segment) });
  }
  if (venues.length > 0) return venues;
  // Card layout changed: fall back to the flat scan, which still finds every
  // venue but can no longer say which screen each one is running.
  for (const m of allMatches(VENUE_RE, html)) {
    if (!seen.has(m[1]!)) {
      seen.add(m[1]!);
      venues.push({ name: m[2]!, code: m[1]!, screens: null });
    }
  }
  return venues;
}

/** Raw "venueCode" keys, to tell an empty date from a stale parser. */
export function venueKeyCount(html: string): number {
  return html.split('"venueCode"').length - 1;
}
