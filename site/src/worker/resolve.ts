/**
 * Turning "this film exists" into "this film can be watched".
 *
 * A target created from a film's page has no booking code, because until
 * booking opens there is no showtimes page for one to live on. Once the CTA
 * goes live we have to find it — and it is often NOT the code in the page URL.
 * The Paradise's page was ET00518274 while its showtimes needed ET00518514.
 *
 * So candidates are PROVEN, never assumed. Each is tried against a real
 * showtimes URL and judged by the engine's own outcomes:
 *
 *   BAD_CODE   no venues and no date strip — this is not the booking code
 *   anything   the page knew what we were asking about, so the code is right
 *   else       (OK_SHOWS, OK_EMPTY and DATE_FALLBACK all prove it)
 *
 * That distinction is why guessing is survivable here and nowhere else: a
 * wrong booking code is normally invisible, HTTP 200 with zero venues forever,
 * and the engine is the one thing that can tell it apart from a quiet date.
 */

import { Outcome, showtimesUrl } from "../engine/index.js";
import { fetchShowtimes, sleep, type ContextProvider, PACING_MS } from "./fetch.js";

export interface ResolveResult {
  bookCode: string | null;
  tried: { code: string; outcome: string }[];
}

/** A date to probe with. Today in IST: whatever is on sale will include it or
 *  redirect to the first date that is, and both answers prove the code. */
function probeDate(now = new Date()): string {
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000);
  return `${ist.getFullYear()}${String(ist.getMonth() + 1).padStart(2, "0")}${String(ist.getDate()).padStart(2, "0")}`;
}

export async function resolveBookCode(
  movieUrl: string,
  candidates: string[],
  language: string | null,
  provider?: ContextProvider,
  now = new Date(),
): Promise<ResolveResult> {
  const date = probeDate(now);
  const tried: { code: string; outcome: string }[] = [];

  for (const [i, code] of candidates.entries()) {
    // Paced like any other read. Resolution is not urgent enough to justify
    // hammering an IP that is already refused half the time.
    if (i > 0) await sleep(PACING_MS);

    const url = showtimesUrl(movieUrl, date, { bookCode: code, language });
    const { reading } = await fetchShowtimes(url, date, provider);
    tried.push({ code, outcome: reading.outcome });

    if (reading.outcome === Outcome.BLOCKED || reading.outcome === Outcome.PAGE_ERROR) {
      // Learned nothing about this code. Stop rather than burn the remaining
      // candidates against a wall — the next pass will try again.
      break;
    }
    if (reading.outcome !== Outcome.BAD_CODE) {
      return { bookCode: code, tried };
    }
  }

  return { bookCode: null, tried };
}
