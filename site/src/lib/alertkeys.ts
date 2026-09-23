/**
 * What a watch has been told about, and what it has been told to stop about.
 *
 * A watch covers a date, but a date can go on sale one cinema at a time. If
 * "Got it" silenced the whole date, the first multiplex to list would decide
 * whether you ever hear about PCX at Prasads — which is the screen you built
 * the watch for. check.py acknowledged per theatre per day; this restores it
 * at the finer grain of theatre AND screen.
 *
 * A key names one thing you can be told about, and one thing you can silence:
 *
 *   "AMBH|HDR By Barco"   a specific room at a specific cinema
 *   "AMBH|*"              that cinema, any screen (you picked no screen)
 *   "*"                   the whole date (you narrowed nothing at all)
 *
 * The last case keeps the simple watch simple: no narrowing means one alert
 * and one "Got it", exactly as before, rather than seventeen of each.
 */

import { screenMatches, type Venue } from "../engine/index.js";

export interface CinemaPick { code: string; screens: string[] }

export interface AlertTarget {
  key: string;
  code: string;
  venueName: string;
  /** null when the key covers the whole cinema or the whole date. */
  screen: string | null;
}

export const WHOLE_DATE = "*";

function upper(s: string | null | undefined): string {
  return (s ?? "").toUpperCase();
}

/**
 * Keys are lowercased end to end.
 *
 * They are stored and compared as opaque identifiers, and BookMyShow is not
 * consistent about the case of either a venue code or a screen name. A key
 * that changed case between two reads would silently re-announce a cinema
 * already acknowledged.
 */
function makeKey(code: string, screen: string | null): string {
  return `${(code ?? "").toLowerCase()}|${screen ? screen.toLowerCase() : "*"}`;
}

/**
 * Everything this watch can currently be alerted about, given what is listed.
 *
 * One entry per (cinema, screen) the person actually asked for and that is
 * actually running — never per venue BMS happens to list, or a narrowed watch
 * would be told about cinemas it was explicitly narrowed away from.
 */
export function matchedTargets(
  picks: CinemaPick[], screenFilters: string[], listed: Venue[],
): AlertTarget[] {
  // No narrowing: the date is the only thing there is to be told about.
  if (picks.length === 0 && screenFilters.length === 0) {
    return listed.length > 0
      ? [{ key: WHOLE_DATE, code: WHOLE_DATE, venueName: "", screen: null }]
      : [];
  }

  const out: AlertTarget[] = [];

  if (picks.length > 0) {
    for (const pick of picks) {
      const venue = listed.find((v) => upper(v.code) === upper(pick.code));
      if (!venue) continue;
      if (pick.screens.length === 0) {
        out.push({ key: makeKey(pick.code, null), code: pick.code, venueName: venue.name, screen: null });
        continue;
      }
      for (const screen of pick.screens) {
        if (screenMatches(screen, venue)) {
          out.push({
            key: makeKey(pick.code, screen),
            code: pick.code, venueName: venue.name, screen,
          });
        }
      }
    }
    return out;
  }

  // City-wide screen filters: one key per cinema running one of them.
  for (const venue of listed) {
    for (const screen of screenFilters) {
      if (screenMatches(screen, venue)) {
        out.push({
          key: makeKey(venue.code, screen),
          code: venue.code, venueName: venue.name, screen,
        });
      }
    }
  }
  return out;
}

/**
 * The ones worth an alert: matched, not already announced, not silenced.
 *
 * This is what lets a second cinema opening an hour later be news rather than
 * nothing, without re-announcing the first one on every pass.
 */
export function unannounced(
  matched: AlertTarget[], notified: string[], acked: string[],
): AlertTarget[] {
  const seen = new Set([...notified, ...acked]);
  return matched.filter((t) => !seen.has(t.key));
}

/** Everything still live: announced but not silenced. Drives reminders. */
export function liveTargets(matched: AlertTarget[], acked: string[]): AlertTarget[] {
  const off = new Set(acked);
  return matched.filter((t) => !off.has(t.key));
}

/** How a key reads in a sentence. */
export function describe(t: AlertTarget): string {
  if (t.key === WHOLE_DATE) return "this date";
  const name = t.venueName.split(":")[0]!.trim() || t.code;
  return t.screen ? `${name} — ${t.screen}` : name;
}
