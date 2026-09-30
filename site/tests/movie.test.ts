/**
 * Detecting that a film has gone on sale at all.
 *
 * The case the rest of the engine cannot serve: a film months out with no
 * showtimes page in existence, so no booking code to watch. Pasting its link
 * is the most valuable watch there is, and until now it was impossible to
 * create.
 *
 * The HTML here is synthetic, modelled on what check.py recorded from real
 * pages: a bookable page renders a CTA container with
 * data-phase="postRelease"; a pre-release page does not render it at all.
 */

import { MovieOutcome, readMoviePage, releaseDateFrom } from "../src/engine/movie.js";

const CHROME = "Drop Watcher sample page. ".repeat(60); // > 500 chars of body

function page(inner: string): string {
  return `<!doctype html><html><body><div id="wrap">${inner}</div>
    <div class="filler">${"x".repeat(2000)}</div></body></html>`;
}

const PRE_RELEASE = page(`
  <h1>Avengers: Doomsday</h1>
  <span>Releasing on 18 Dec 2026</span>
  <button>Notify me</button>
  <a href="/movies/hyderabad/avengers-doomsday/ET00439706">more</a>
`);

const BOOKABLE = page(`
  <h1>The Paradise</h1>
  <div id="page-cta-container">
    <button data-phase="postRelease">Book tickets</button>
  </div>
  <script>{"eventCode":"ET00518514","altCode":"ET00518514","pageCode":"ET00518274"}</script>
`);

const CHALLENGE = "<html><body>Sorry, you have been blocked</body></html>";

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log("\nA film with no Book tickets button");
let r = readMoviePage(PRE_RELEASE, { bodyText: CHROME });
check("not open", r.outcome, MovieOutcome.NOT_OPEN);
check("and offers no codes to try", r.candidates, []);

console.log("\nA film that has gone on sale");
r = readMoviePage(BOOKABLE, { bodyText: CHROME, pageCode: "ET00518274" });
check("open", r.outcome, MovieOutcome.OPEN);
check("detected structurally, not from wording", r.detail, "cta phase postRelease");
check("the page's own code is tried first", r.candidates[0], "ET00518274");
check("but the real booking code is also a candidate",
  r.candidates.includes("ET00518514"), true);

console.log("\nWording fallback, if the phase attribute ever changes");
r = readMoviePage(page(`<h1>x</h1><div>Book tickets</div><span>ET00111111</span>`), {
  bodyText: `${CHROME} Book tickets`,
});
check("still open", r.outcome, MovieOutcome.OPEN);
check("via rendered text", r.detail, "cta text says book tickets");

console.log("\nBut 'book tickets' in the SOURCE alone is not enough");
// A pre-release page embeds a "Movies Now Showing" widget naming films that
// ARE bookable. Trusting raw HTML would call every future release open.
check("widget markup does not fake an open booking",
  readMoviePage(
    page(`<h1>Doomsday</h1><div class="now-showing"><a>Book tickets</a></div>`),
    { bodyText: CHROME },
  ).outcome,
  MovieOutcome.NOT_OPEN);

console.log("\nBlocked must never read as 'not open yet'");
r = readMoviePage(CHALLENGE, { bodyText: "Sorry, you have been blocked", httpStatus: 403 });
check("blocked", r.outcome, MovieOutcome.BLOCKED);
check("not NOT_OPEN", r.outcome === MovieOutcome.NOT_OPEN, false);

r = readMoviePage(CHALLENGE, { bodyText: "Sorry, you have been blocked" });
check("markers alone are enough, without a 403", r.outcome, MovieOutcome.BLOCKED);

r = readMoviePage(page("<h1>x</h1>"), { bodyText: "tiny" });
check("a 691-char interstitial is blocked, not 'not open'",
  readMoviePage(page("<h1>x</h1>"), { bodyText: "x".repeat(400) }).outcome,
  MovieOutcome.BLOCKED);

console.log("\nAn unrecognisable page is never 'not open yet' either");
check("too short to read", readMoviePage("<html></html>", { bodyText: CHROME }).outcome,
  MovieOutcome.UNPARSEABLE);
check("BMS's own error page", readMoviePage(page("<h1>x</h1>"), {
  bodyText: "Oops! Something went wrong " + CHROME,
}).outcome, MovieOutcome.UNPARSEABLE);

console.log("\nRelease date decides how often we look");
check("day, short month, comma", releaseDateFrom("Releasing on 25 Sep, 2026"), "20260925");
check("no comma", releaseDateFrom("Releasing on 18 Dec 2026"), "20261218");
check("single digit day", releaseDateFrom("releasing on 1 Oct, 2026"), "20261001");
check("buried in other text",
  releaseDateFrom("Doomsday · Releasing on 09 Jan, 2027 · Action"), "20270109");
check("absent", releaseDateFrom("no date here"), null);
check("nonsense month", releaseDateFrom("Releasing on 32 Foo, 2026"), null);


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
