/**
 * What someone is allowed to paste, and what we refuse to guess.
 *
 * The round-trip test at the end is the important one: whatever we store must
 * rebuild the exact URL BookMyShow itself produced. On 2026-09-22 a watch was
 * built on a booking code inferred from the movie page and read an empty page
 * forever while tickets were on sale.
 */

import { parseBmsUrl, fromDateInput, toDateInput } from "../src/lib/bms-url.js";
import { showtimesUrl } from "../src/engine/index.js";

const REAL_SHOWTIMES =
  "https://in.bookmyshow.com/movies/kakinada/the-paradise/buytickets/" +
  "ET00518514/20260924?etCodes=*&language=telugu&refEventCode=ET00518514";
const MOVIE_PAGE =
  "https://in.bookmyshow.com/movies/kakinada/the-paradise/ET00518274";

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log("\nA showtimes URL carries everything needed");
const s = parseBmsUrl(REAL_SHOWTIMES);
check("recognised as showtimes", s.kind, "showtimes");
if (s.kind === "showtimes") {
  check("booking code taken from BMS, not guessed", s.bookCode, "ET00518514");
  check("city", s.city, "kakinada");
  check("slug", s.slug, "the-paradise");
  check("language", s.language, "telugu");
  check("date suggestion", s.date, "20260924");
  check("movie url head", s.movieUrl,
    "https://in.bookmyshow.com/movies/kakinada/the-paradise");
  check("page code NOT defaulted to the booking code", s.pageCode, null);
}

console.log("\nRound trip: what we store must rebuild what BMS gave us");
if (s.kind === "showtimes") {
  check("rebuilt URL is byte-identical",
    showtimesUrl(s.movieUrl, "20260924", { bookCode: s.bookCode, language: s.language }),
    REAL_SHOWTIMES);
  check("and works for a date that is not on sale yet",
    showtimesUrl(s.movieUrl, "20260923", { bookCode: s.bookCode, language: s.language }),
    REAL_SHOWTIMES.replace("20260924", "20260923"));
}

console.log("\nA movie page is refused rather than guessed at");
const m = parseBmsUrl(MOVIE_PAGE);
check("recognised as a movie page", m.kind, "movie");
check("and says what is missing", m.kind === "movie" ? m.missing : "", "bookCode");
check("page code kept as the page's own", m.kind === "movie" ? m.pageCode : "", "ET00518274");

console.log("\nThe worker fetches what we store, so hosts are allow-listed");
check("another host is refused",
  parseBmsUrl("https://evil.example.com/movies/x/buytickets/ET1/20260101").kind,
  "unrecognised");
check("localhost is refused",
  parseBmsUrl("http://127.0.0.1:8080/movies/a/b/ET00000001").kind, "unrecognised");
check("file scheme is refused",
  parseBmsUrl("file:///etc/passwd").kind, "unrecognised");
check("nonsense is refused", parseBmsUrl("not a url").kind, "unrecognised");
check("empty is refused", parseBmsUrl("   ").kind, "unrecognised");
check("a bookmyshow page that is neither is refused",
  parseBmsUrl("https://in.bookmyshow.com/explore/home/hyderabad").kind, "unrecognised");

console.log("\nDate field conversions");
check("to input", toDateInput("20260923"), "2026-09-23");
check("from input", fromDateInput("2026-09-23"), "20260923");
check("rejects a malformed date", fromDateInput("23/09/2026"), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
