/**
 * Why a narrowed watch is quiet.
 *
 * Once someone picks a particular auditorium, silence acquires a second
 * meaning: the film may be on sale at that very cinema, just not in that room.
 * From outside, that is indistinguishable from "nothing on sale yet" — which
 * is the exact ambiguity this whole project exists to remove, reintroduced
 * through the back door by a feature we added on purpose.
 *
 * check.py said it plainly:
 *
 *   AMB (IMAX): listed, running English • 2D | LED SCREEN DOLBY ATMOS
 *
 * The rewrite lost that. This puts it back, as something testable.
 */

import { screenMatches, type Venue } from "../engine/index.js";
import { formatChoices } from "./format.js";

export interface CinemaPick { code: string; screens: string[] }

export type PickStatus =
  /** Listed, and on a screen this watch asked for. */
  | { kind: "matched"; code: string; name: string; screens: string[] }
  /** Listed at this cinema — but NOT on the screens asked for. The quiet
   *  failure: the film is bookable here and this watch will never say so. */
  | { kind: "wrong_screen"; code: string; name: string; wanted: string[]; running: string[] }
  /** Not listed at this cinema at all. Ordinary waiting. */
  | { kind: "not_listed"; code: string; name: string; wanted: string[] };

/**
 * How each picked cinema is doing against what was actually listed.
 *
 * `listed` is the venue list from the last clean read of that date. An empty
 * list means nothing is on sale yet, so every pick is simply "not listed" —
 * never "wrong screen", which would imply we had looked and found the room
 * busy with something else.
 */
export function narrowingReport(picks: CinemaPick[], listed: Venue[]): PickStatus[] {
  const byCode = new Map(listed.map((v) => [(v.code ?? "").toUpperCase(), v]));

  return picks.map((pick) => {
    const venue = byCode.get(pick.code.toUpperCase());
    const name = venue?.name ?? pick.code;

    if (!venue) {
      return { kind: "not_listed", code: pick.code, name, wanted: pick.screens };
    }
    if (pick.screens.length === 0) {
      return { kind: "matched", code: pick.code, name, screens: formatChoices(venue.screens ?? []) };
    }
    const hits = pick.screens.filter((s) => screenMatches(s, venue));
    if (hits.length > 0) {
      return { kind: "matched", code: pick.code, name, screens: hits };
    }
    return {
      kind: "wrong_screen",
      code: pick.code,
      name,
      wanted: pick.screens,
      // What it IS running, so the sentence is useful rather than merely
      // negative. "Not your screen" is a shrug; "running HDR By Barco" is
      // something you can act on.
      running: formatChoices(venue.screens ?? []),
    };
  });
}

/** The ones worth telling somebody about. */
export function wrongScreens(report: PickStatus[]): PickStatus[] {
  return report.filter((r) => r.kind === "wrong_screen");
}

/**
 * True when the date is on sale somewhere but this watch cannot fire.
 *
 * Drives the line on the card and the panel on the watch's own page. Without
 * it a narrowed watch sits on "Waiting. All good." while the film is bookable
 * at the cinema it names, which is a lie of omission.
 */
export function listedButNotMine(
  picks: CinemaPick[], screenFilters: string[], listed: Venue[],
): boolean {
  if (listed.length === 0) return false;

  if (picks.length > 0) {
    return narrowingReport(picks, listed).every((r) => r.kind !== "matched");
  }
  if (screenFilters.length > 0) {
    return !listed.some((v) => screenFilters.some((s) => screenMatches(s, v)));
  }
  // No narrowing at all: anything listed would have fired already.
  return false;
}
