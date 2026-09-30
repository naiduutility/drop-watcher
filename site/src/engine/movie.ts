/**
 * Reading a film's own page, to know whether booking has opened at all.
 *
 * Needed for the case the rest of the engine cannot serve: a film months out,
 * with no showtimes page in existence, so no booking code to watch. check.py
 * did exactly this and the rewrite dropped it, which left the most valuable
 * watch of all — "tell me the moment this goes on sale" — impossible to create.
 *
 * Two signals, taken from check.py's hard-won notes:
 *
 *   PRIMARY  the CTA button's data-phase is "postRelease". Structural, so it
 *            survives wording and localisation changes.
 *   BACKUP   the CTA or page text reads "Book tickets" / "Book now".
 *
 * A /buytickets/ href is deliberately NOT used: it was confirmed never to
 * appear even on a bookable page, because the button navigates by JavaScript.
 */

import { looksBlocked, looksLikePageError } from "./parse.js";

export const MovieOutcome = {
  /** Booking is open. Now we need the booking code. */
  OPEN: "open",
  /** Rendered fine, no booking yet. The ordinary state of a future release. */
  NOT_OPEN: "not_open",
  /** Anti-bot wall. Interpret nothing. */
  BLOCKED: "blocked",
  /** 200, but nothing we recognise — never read as "not open yet". */
  UNPARSEABLE: "unparseable",
} as const;

export type MovieOutcome = (typeof MovieOutcome)[keyof typeof MovieOutcome];

export interface MovieRead {
  outcome: MovieOutcome;
  /** "Releasing on 18 Dec, 2026" as YYYYMMDD, when the page says so. How
   *  close that is decides how often the film is worth checking: a release
   *  tomorrow deserves every pass, one in December does not. */
  releaseDate: string | null;
  /** ET codes found on the page, best guess first. The booking code is often
   *  NOT the one in the page URL — The Paradise's page was ET00518274 while
   *  its showtimes needed ET00518514 — so these are candidates to be PROVEN,
   *  never assumed. */
  candidates: string[];
  detail: string;
}

const ET_RE = /ET\d{6,}/g;
const RELEASING_RE =
  /releasing on\s+(\d{1,2})\s+([a-z]{3,})[,\s]+(\d{4})/i;
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** The advertised release date, if the page states one. */
export function releaseDateFrom(text: string): string | null {
  const m = text.match(RELEASING_RE);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const day = Number(m[1]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return `${m[3]}${String(month + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}
const PHASE_RE = /data-phase\s*=\s*"([^"]+)"/gi;

/**
 * A real rendered movie page is thousands of characters of chrome alone. This
 * threshold is check.py's, set after a 691-character Cloudflare interstitial
 * sailed through as a harmless "not open yet" — the failure that silences a
 * watcher forever.
 */
const MIN_BODY = 500;

export function readMoviePage(
  html: string,
  opts: { bodyText?: string; httpStatus?: number; pageCode?: string | null } = {},
): MovieRead {
  const { bodyText = "", httpStatus = 200, pageCode = null } = opts;

  if (httpStatus >= 400) {
    return { outcome: MovieOutcome.BLOCKED, candidates: [], releaseDate: null, detail: `HTTP ${httpStatus}` };
  }
  if (looksBlocked(bodyText)) {
    return { outcome: MovieOutcome.BLOCKED, candidates: [], releaseDate: null, detail: "anti-bot markers" };
  }
  if (bodyText && bodyText.length < MIN_BODY) {
    return {
      outcome: MovieOutcome.BLOCKED,
      candidates: [],
      releaseDate: null,
      detail: `rendered body only ${bodyText.length} chars`,
    };
  }
  if (looksLikePageError(bodyText)) {
    return { outcome: MovieOutcome.UNPARSEABLE, candidates: [], releaseDate: null, detail: "BMS error page" };
  }
  if (!html || html.length < 1000) {
    return { outcome: MovieOutcome.UNPARSEABLE, candidates: [], releaseDate: null, detail: "page too short to read" };
  }

  const phases = [...html.matchAll(PHASE_RE)].map((m) => m[1]!.toLowerCase());
  const byPhase = phases.includes("postrelease");
  // The wording fallback reads RENDERED text only, never the raw HTML. A
  // pre-release page carries a "Movies Now Showing in <city>" widget whose
  // markup names other films that ARE bookable, so "book tickets" appears in
  // the source of a page that has no such button at all. The structural
  // data-phase attribute is in the HTML and is safe for either transport.
  const low = bodyText.toLowerCase();
  const byText = low.includes("book tickets") || low.includes("book now");

  const releaseDate = releaseDateFrom(bodyText || html);

  if (!byPhase && !byText) {
    return {
      outcome: MovieOutcome.NOT_OPEN,
      candidates: [],
      releaseDate,
      detail: phases.length ? `cta phase: ${phases.join(", ")}` : "no booking CTA",
    };
  }

  // Booking is open. Gather codes, most frequent first, but always try the
  // page's own code first: it is right more often than not, and being wrong
  // about it is cheap because every candidate gets proven before use.
  const counts = new Map<string, number>();
  for (const m of html.matchAll(ET_RE)) {
    counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
  const candidates = pageCode
    ? [pageCode, ...ranked.filter((c) => c !== pageCode)]
    : ranked;

  return {
    outcome: MovieOutcome.OPEN,
    candidates: candidates.slice(0, 8),
    releaseDate,
    detail: byPhase ? "cta phase postRelease" : "cta text says book tickets",
  };
}
