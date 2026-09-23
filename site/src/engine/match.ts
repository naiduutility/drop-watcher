/**
 * Matching a person's theatre/screen wording against BMS's venue names.
 *
 * Behaviour is unchanged from the Python engine — this part has never
 * misfired — and the shared fixtures prove the two agree.
 */

import type { Venue } from "./parse.js";

/** Lowercase and drop apostrophes, so Prasad's == Prasads. */
export function normalise(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/['’]/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does every word of `entry` appear as a whole word in `text`?
 *
 * Order and punctuation ignored, so "allu cinemas kokapet" matches
 * "Allu Cinemas: Kokapet" — which substring matching would miss, because BMS
 * writes venues as "Name: Location". Whole words, not substrings, keep "AMB"
 * off "Ambica Theatre".
 */
function allWordsIn(entry: string, text: string): boolean {
  const words = normalise(entry).match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return false;
  const hay = normalise(text);
  return words.every((w) =>
    new RegExp("\\b" + escapeRegExp(w) + "\\b").test(hay)
  );
}

/** Exact venue code, or every word of the entry in the venue name. */
export function theatreMatches(entry: string, venue: Venue): boolean {
  if (entry.trim().toUpperCase() === (venue.code ?? "").toUpperCase()) return true;
  return allWordsIn(entry, venue.name ?? "");
}

/**
 * Is the wanted screen among the formats this venue is running?
 *
 * False when the venue's screens are unknown or empty — never a match on a
 * guess. Callers report that case separately, because "could not read the
 * screens" and "that screen is not running" must not look alike.
 */
export function screenMatches(entry: string, venue: Venue): boolean {
  return (venue.screens ?? []).some((x) => allWordsIn(entry, x));
}

/** The venues satisfying one venue (+ optional screen) request. */
export function matchedVenues(
  venues: Venue[], venueEntry: string, screenEntry?: string | null,
): Venue[] {
  let found = venues.filter((v) => theatreMatches(venueEntry, v));
  if (screenEntry) found = found.filter((v) => screenMatches(screenEntry, v));
  return found;
}

/**
 * Screens running at the venues matching this entry.
 *
 * null when the venue is not listed at all; [] when it is listed but its
 * screens could not be read. That split is what makes "still waiting" useful:
 * "AMB is listed, running only Screen 3" is very different news from "AMB is
 * not listed yet".
 */
export function screensAt(venues: Venue[], venueEntry: string): string[] | null {
  let listed = false;
  const screens: string[] = [];
  const seen = new Set<string>();
  for (const v of venues) {
    if (!theatreMatches(venueEntry, v)) continue;
    listed = true;
    for (const label of v.screens ?? []) {
      if (!seen.has(normalise(label))) {
        seen.add(normalise(label));
        screens.push(label);
      }
    }
  }
  return listed ? screens : null;
}
