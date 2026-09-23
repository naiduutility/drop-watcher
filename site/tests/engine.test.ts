/**
 * The Python engine's test suite, re-run against the TypeScript port.
 *
 * Same gzipped fixtures — the genuine bytes BookMyShow returned on
 * 2026-09-22 — and the same assertions, so the port is proven equivalent
 * rather than trusted. Each case below is a bug that actually shipped and
 * actually cost somebody an alert.
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  Outcome, mayAlert, isConclusive, readShowtimes, showtimesUrl, dateInUrl,
} from "../src/engine/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Shared with the Python suite: one set of captured bytes, two engines.
const FIXTURES = join(HERE, "..", "..", "tests", "fixtures");
const PARADISE = "https://in.bookmyshow.com/movies/kakinada/the-paradise/ET00518274";

const fixture = (name: string) =>
  gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");

const KAKINADA_24TH = fixture("kakinada-20260924-real.html.gz");
const BLOCKED_PAGE = fixture("cloudflare-403.html.gz");

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

console.log("\nThe false premiere alert (22 Sep 17:26)");
console.log("  BMS was asked for the 23rd and returned the 24th's five venues.");
let r = readShowtimes(KAKINADA_24TH, { requestedDate: "20260923" });
check("outcome is DATE_FALLBACK", r.outcome, Outcome.DATE_FALLBACK);
check("must not alert", mayAlert(r), false);
check("is conclusive (a real answer: not on sale)", isConclusive(r), true);
check("reports the date actually served", r.servedDate, "20260924");
check("23rd absent from the strip", r.offeredDates.includes("20260923"), false);

console.log("\nThe same payload, asked for the date it is actually for");
r = readShowtimes(KAKINADA_24TH, { requestedDate: "20260924" });
check("outcome is OK_SHOWS", r.outcome, Outcome.OK_SHOWS);
check("may alert", mayAlert(r), true);
check("five Kakinada venues", r.venues.length, 5);

console.log("\nCloudflare 403 (three of four scrapes in run 3616)");
r = readShowtimes(BLOCKED_PAGE, { bodyText: BLOCKED_PAGE, requestedDate: "20260923", httpStatus: 403 });
check("outcome is BLOCKED", r.outcome, Outcome.BLOCKED);
check("must not alert", mayAlert(r), false);
check("NOT conclusive - we learned nothing", isConclusive(r), false);

console.log("\nA blocked page must never read as 'no shows'");
check("BLOCKED != DATE_FALLBACK", r.outcome === Outcome.DATE_FALLBACK, false);
check("BLOCKED != OK_EMPTY", r.outcome === Outcome.OK_EMPTY, false);

console.log("\nThe national-code trap (date strip lied, showDate did not)");
console.log("  Kakinada under ET00436621: strip HAS the 23rd, payload was the 24th.");
const faked = KAKINADA_24TH.replace('"dateCode":"20260924"', '"dateCode":"20260923"');
r = readShowtimes(faked, { requestedDate: "20260923" });
check("showDate overrules the strip", r.outcome, Outcome.DATE_FALLBACK);
check("must not alert", mayAlert(r), false);

console.log("\nA healthy page must not read as blocked");
console.log("  Every real BMS page embeds cdn-loop: cloudflare in its headers,");
console.log("  so scanning raw HTML for block markers condemns every good page.");
check("fixture really does contain the word", KAKINADA_24TH.toLowerCase().includes("cloudflare"), true);
r = readShowtimes(KAKINADA_24TH, { bodyText: "x".repeat(4000), requestedDate: "20260924" });
check("still OK_SHOWS with body text present", r.outcome, Outcome.OK_SHOWS);
check("still allowed to alert", mayAlert(r), true);

console.log("\nStale parser: venues present but undateable");
r = readShowtimes('"type":"venue-card"{"venueCode":"X","venueName":"Y"}', { requestedDate: "20260923" });
check("outcome is UNPARSEABLE", r.outcome, Outcome.UNPARSEABLE);
check("must not alert", mayAlert(r), false);
check("not conclusive", isConclusive(r), false);

console.log("\nWrong booking code: nothing on the page at all");
r = readShowtimes("<html><body>nothing here</body></html>", { requestedDate: "20260923" });
check("outcome is BAD_CODE", r.outcome, Outcome.BAD_CODE);
check("must not alert", mayAlert(r), false);

console.log("\nURL building matches the URL BMS itself gave us");
const built = showtimesUrl(PARADISE, "20260924", { bookCode: "ET00518514", language: "telugu" });
check("byte-identical to the real booking URL", built,
  "https://in.bookmyshow.com/movies/kakinada/the-paradise/buytickets/" +
  "ET00518514/20260924?etCodes=*&language=telugu&refEventCode=ET00518514");
check("date reads back out", dateInUrl(built), "20260924");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
