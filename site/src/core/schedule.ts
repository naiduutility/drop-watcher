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

/**
 * How often a target is polled when everything is healthy.
 *
 * The ladder exists because "unreleased" spans a film opening tomorrow and one
 * opening in fifteen months, and an hourly poll of the second costs ten
 * thousand requests — every one of them taken from the budget the first needs.
 * BookMyShow already refuses about half of what we send.
 *
 * `hot` is two minutes rather than five so a target is due on every cron pass;
 * the cron's own five-minute period is the real floor.
 */
export const BASE_INTERVAL_MS = {
  /** A premiere expected to drop tonight. */
  hot: 2 * 60_000,
  brisk: 15 * 60_000,
  normal: 30 * 60_000,
  cold: 60 * 60_000,
  slow: 6 * 60 * 60_000,
  /** A film announced for next year. Twice a day is still 700 reads before it
   *  opens, which is plenty to catch a date appearing months early. */
  glacial: 24 * 60 * 60_000,
} as const;

export type Priority = keyof typeof BASE_INTERVAL_MS;

/**
 * Backoff never pushes a check further out than this, or a watch that got
 * blocked at a bad moment would sleep through the thing it was waiting for.
 *
 * It is a ceiling, never a floor: a glacial watch that gets blocked must not
 * be *sped up* to every 30 minutes by its own failures.
 */
export const MAX_BACKOFF_MS = 30 * 60_000;

/**
 * A slow watch wakes itself up as the film approaches.
 *
 * Someone setting "once a day" for a film next December is right on the day
 * they set it and wrong by the week of release, and expecting them to come
 * back and change it is expecting them to remember the thing they installed
 * this to stop remembering. The release date BookMyShow advertises is already
 * read and stored on every pre-release pass, so this costs nothing new.
 *
 * Escalation only ever makes a watch FASTER. Picking "every 5 min" for a film
 * a year out is a choice, not a mistake to be corrected.
 */
export const ESCALATION: { withinDays: number; floor: Priority }[] = [
  { withinDays: 1, floor: "hot" },
  { withinDays: 7, floor: "cold" },
];

/**
 * Midnight of the current IST day, as a UTC timestamp.
 *
 * Shifting the instant and reading UTC getters, rather than shifting by
 * `getTimezoneOffset()` and reading local getters: the latter is only correct
 * when the host clock happens to be UTC. It is on the runner and on Vercel, so
 * the older form worked in production and was wrong by a day on an Indian
 * laptop between 18:30 and midnight — the exact hours a premiere drops.
 */
function istMidnight(now: Date): number {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

/** Today in IST, as YYYYMMDD. */
export function istToday(now: Date): string {
  const d = new Date(istMidnight(now));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    + `${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from today (IST) to a YYYYMMDD date. Negative once it has passed. */
export function daysUntil(releaseDate: string | null | undefined, now: Date): number | null {
  if (!releaseDate || !/^\d{8}$/.test(releaseDate)) return null;
  const y = Number(releaseDate.slice(0, 4));
  const m = Number(releaseDate.slice(4, 6));
  const d = Number(releaseDate.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.round((Date.UTC(y, m - 1, d) - istMidnight(now)) / 86_400_000);
}

/** The cadence a target should actually be polled at, given how close it is. */
export function effectivePriority(
  chosen: Priority, releaseDate: string | null | undefined, now: Date,
): Priority {
  const days = daysUntil(releaseDate, now);
  if (days === null) return chosen;
  for (const step of ESCALATION) {
    if (days > step.withinDays) continue;
    return BASE_INTERVAL_MS[step.floor] < BASE_INTERVAL_MS[chosen] ? step.floor : chosen;
  }
  return chosen;
}

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
  // The ceiling is at least the base. Without that, a watch polled once a day
  // would be dragged up to every 30 minutes by being blocked — backoff making
  // a watch faster is the opposite of what it is for.
  const ceiling = Math.max(base, MAX_BACKOFF_MS);
  const backed = failures === 0
    ? base
    : Math.min(base * 2 ** Math.min(failures, 6), ceiling);
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
