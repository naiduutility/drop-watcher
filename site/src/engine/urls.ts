/** Building and reading BookMyShow URLs. */

const URL_DATE_RE = /\/buytickets\/[^/]+\/(\d{8})/;

/** BMS movie codes look like ET00514163 and are stable per movie. */
export function movieIdFromUrl(url: string): string {
  return url.match(/(ET\d+)/)?.[1] ?? url.replace(/\/+$/, "").split("/").pop()!;
}

/** .../movies/hyderabad/avengers-endgame-encore/ET00514163 -> the slug. */
export function movieSlugFromUrl(url: string): string {
  const parts = url.split("?")[0]!.replace(/\/+$/, "").split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (/^ET\d+$/.test(parts[i]!) && i > 0) return parts[i - 1]!;
  }
  return parts.at(-1) ?? "";
}

/** .../movies/kakinada/the-paradise/ET00518274 -> "kakinada". */
export function cityFromUrl(url: string): string {
  const parts = url.split("?")[0]!.split("/").filter(Boolean);
  const i = parts.indexOf("movies");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1]!;
  return "unknown";
}

/** The YYYYMMDD a showtimes URL asks for, or null. */
export function dateInUrl(url: string): string | null {
  return url.match(URL_DATE_RE)?.[1] ?? null;
}

export interface ShowtimesUrlOptions {
  /** The BOOKING event code, which for a re-release or a per-language or
   *  per-city event is NOT the movie page's code. Getting it wrong returns a
   *  page with zero venue records and no error at all, so it is resolved and
   *  proven once at creation rather than guessed every run. */
  bookCode?: string | null;
  language?: string | null;
}

export function showtimesUrl(
  movieUrl: string, dateYYYYMMDD: string, opts: ShowtimesUrlOptions = {},
): string {
  const base = movieUrl.split("?")[0]!.replace(/\/+$/, "");
  const head = /\/ET\d+$/.test(base) ? base.slice(0, base.lastIndexOf("/")) : base;
  const pageCode = movieIdFromUrl(movieUrl);
  const code = opts.bookCode || pageCode;
  let url = `${head}/buytickets/${code}/${dateYYYYMMDD}?etCodes=*`;
  if (opts.language) url += `&language=${opts.language}`;
  if (code !== pageCode) url += `&refEventCode=${code}`;
  return url;
}
