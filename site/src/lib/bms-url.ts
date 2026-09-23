/**
 * Turning a pasted BookMyShow URL into something worth watching.
 *
 * The hard-won rule: the BOOKING code is not derivable from a movie page URL.
 * On 2026-09-22 a watch was built from the movie page's ET00518274 while the
 * showtimes path actually needed ET00518514, and the result was HTTP 200 with
 * zero venues — forever, silently, while booking was wide open. A watch that
 * cannot possibly fire must never be created.
 *
 * So a movie-page URL is accepted as INCOMPLETE and the person is asked to
 * click through to showtimes and paste that instead. It is one extra step and
 * it is the difference between a watch that works and one that lies.
 */

import { cityFromUrl, movieSlugFromUrl } from "../engine/urls.js";

/** The worker fetches whatever we store, so the host is an allow-list, not a
 *  suggestion. Without this, any member could point it at an internal address. */
const ALLOWED_HOSTS = new Set(["in.bookmyshow.com", "www.bookmyshow.com", "bookmyshow.com"]);

export type ParsedUrl =
  | {
      kind: "showtimes";
      city: string;
      slug: string;
      /** Everything needed to watch. Proven, because BMS itself produced it. */
      bookCode: string;
      language: string | null;
      /** The date that URL happened to be showing. A starting suggestion for
       *  the date picker, not the date they necessarily want. */
      date: string | null;
      movieUrl: string;
      pageCode: string | null;
    }
  | {
      kind: "movie";
      city: string;
      slug: string;
      pageCode: string;
      movieUrl: string;
      /** Why we cannot proceed, in words worth showing a person. */
      missing: "bookCode";
    }
  | { kind: "unrecognised"; reason: string };

const SHOWTIMES_RE = /\/buytickets\/(ET\d+)\/(\d{8})/i;

export function parseBmsUrl(input: string): ParsedUrl {
  const raw = input.trim();
  if (!raw) return { kind: "unrecognised", reason: "Paste a BookMyShow link." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unrecognised", reason: "That does not look like a link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "unrecognised", reason: "Only http(s) links are accepted." };
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return {
      kind: "unrecognised",
      reason: `Only bookmyshow.com links are accepted (got ${url.hostname}).`,
    };
  }

  const city = cityFromUrl(url.href);
  const slug = movieSlugFromUrl(url.href.split("/buytickets/")[0] ?? url.href);

  const shows = url.pathname.match(SHOWTIMES_RE);
  if (shows) {
    const bookCode = shows[1]!.toUpperCase();
    // The head of the path, e.g. https://in.bookmyshow.com/movies/kakinada/the-paradise
    // It carries no ET code, which is fine: showtimesUrl() appends the booking
    // code and, since it differs from the path's trailing segment, also adds
    // the refEventCode that BMS wants.
    const movieUrl = url.origin + url.pathname.slice(0, url.pathname.indexOf("/buytickets/"));
    return {
      kind: "showtimes",
      city, slug, bookCode,
      language: url.searchParams.get("language"),
      date: shows[2]!,
      movieUrl,
      // Unknown from this URL, and NOT defaulted to the booking code —
      // conflating the two is the original sin this module exists to prevent.
      pageCode: null,
    };
  }

  const pageCode = url.pathname.match(/\/(ET\d+)\/?$/i)?.[1]?.toUpperCase();
  if (pageCode) {
    return {
      kind: "movie", city, slug, pageCode,
      movieUrl: url.origin + url.pathname.replace(/\/+$/, ""),
      missing: "bookCode",
    };
  }

  return {
    kind: "unrecognised",
    reason: "That is a BookMyShow link, but not a movie or showtimes page.",
  };
}

/** What to tell someone who pasted a movie page. */
export const NEEDS_SHOWTIMES_HELP =
  "This is the movie page, which does not carry the booking code the watcher " +
  "needs — and guessing it produces a watch that stays silent forever. Tap " +
  "Book tickets on that page, pick any date, then paste the URL from the " +
  "address bar instead.";

/** YYYYMMDD -> the <input type=date> value, and back. */
export function toDateInput(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function fromDateInput(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}
