/**
 * When to look again, and at which dates.
 *
 * Yesterday's watcher asked one question every five minutes, of everything,
 * forever — and BookMyShow's Cloudflare answered three of four requests with a
 * 403. The fix is not a cleverer browser, it is asking less and asking at the
 * right moment.
 *
 * Both functions here are pure, with `now` and randomness injected, so the
 * pacing policy can be tested without a clock, a network or a database.
 */

/** How often a target is polled when everything is healthy. */
export const BASE_INTERVAL_MS = {
  /** A premiere expected to drop tonight. */
  hot: 2 * 60_000,
  normal: 10 * 60_000,
  /** A release three weeks out. Yesterday these were polled every 5 minutes
   *  for no reason, spending the request budget that the hot target needed. */
  cold: 60 * 60_000,
} as const;

export type Priority = keyof typeof BASE_INTERVAL_MS;

/** Backoff never pushes a check further out than this, or a watch that got
 *  blocked at a bad moment would sleep through the thing it was waiting for. */
export const MAX_BACKOFF_MS = 30 * 60_000;

export interface NextDueInput {
  priority: Priority;
  /** Reads in a row that concluded nothing (BLOCKED / PAGE_ERROR /
   *  UNPARSEABLE). Reset to 0 by any conclusive read. */
  consecutiveInconclusive: number;
  now: Date;
  /** [0, 1). Injected so tests are deterministic. */
  random?: number;
}

/**
 * Exponential backoff on inconclusive reads, plus jitter.
 *
 * The jitter is not decoration. Every target waking on the same 5-minute
 * boundary is both a thundering herd against one IP and a very machine-shaped
 * traffic pattern — which is what we are trying not to look like.
 */
export function nextDueDelayMs(input: NextDueInput): number {
  const base = BASE_INTERVAL_MS[input.priority];
  const failures = Math.max(0, input.consecutiveInconclusive);
  const backed = failures === 0
    ? base
    : Math.min(base * 2 ** Math.min(failures, 6), MAX_BACKOFF_MS);
  const r = input.random ?? Math.random();
  // +/- 20%
  return Math.round(backed * (0.8 + 0.4 * r));
}

export function nextDueAt(input: NextDueInput): Date {
  return new Date(input.now.getTime() + nextDueDelayMs(input));
}

export interface FetchPlanInput {
  /** YYYYMMDD dates that still have at least one ARMED subscription. A date
   *  everybody has already been told about costs nothing to skip — that skip
   *  is the real request saving, not any trick with headers. */
  armedDates: string[];
  /** The date strip from the LAST read: every date BMS said has shows.
   *  Empty on a target we have never successfully read. */
  offeredDates: string[];
}

/**
 * Which dates to fetch this cycle.
 *
 * The earliest armed date is ALWAYS fetched, even when the last strip said it
 * has no shows — that is precisely the premiere case, where the whole point is
 * to catch the moment the strip changes. Fetching it also refreshes the strip
 * for free, because every showtimes response carries the full date list.
 *
 * Additional armed dates are fetched only when the strip already says they are
 * on sale. A date we know is not on sale cannot have venues worth reading, so
 * spending a request on it buys nothing but another chance to be blocked.
 */
export function planFetches(input: FetchPlanInput): string[] {
  const armed = [...new Set(input.armedDates)].sort();
  if (armed.length === 0) return [];
  const [earliest, ...rest] = armed as [string, ...string[]];
  const offered = new Set(input.offeredDates);
  return [earliest, ...rest.filter((d) => offered.has(d))];
}
