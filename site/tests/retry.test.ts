/**
 * Retrying a blocked browser read.
 *
 * BookMyShow refuses datacenter IPs intermittently: across four Actions runs
 * the same runner read cleanly and got a 403 in consecutive passes, and once
 * for two dates seconds apart in ONE pass. Without a retry each of those costs
 * a whole cron interval.
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

process.env.BMS_ATTEMPTS = "3";
process.env.BMS_RETRY_DELAY_MS = "1";
process.env.PREFER_BROWSER = "1";

const { fetchShowtimes } = await import("../src/worker/fetch.js");
const { Outcome } = await import("../src/engine/index.js");

const GOOD = gunzipSync(readFileSync("../tests/fixtures/kakinada-20260924-real.html.gz")).toString("utf8");
const BLOCKED = gunzipSync(readFileSync("../tests/fixtures/cloudflare-403.html.gz")).toString("utf8");

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

/** A browser whose Nth attempt succeeds. Counts contexts to prove freshness. */
function fakeBrowser(succeedOnAttempt: number) {
  let contexts = 0;
  const provider = async () => {
    contexts++;
    const blocked = contexts < succeedOnAttempt;
    return {
      newPage: async () => ({
        goto: async () => ({ status: () => (blocked ? 403 : 200) }),
        waitForLoadState: async () => {},
        waitForTimeout: async () => {},
        content: async () => (blocked ? BLOCKED : GOOD),
        innerText: async () => (blocked ? BLOCKED : ""),
        close: async () => {},
      }),
    };
  };
  return { provider: provider as never, contexts: () => contexts };
}

console.log("\nA transient block is retried, not accepted as the answer");
const flaky = fakeBrowser(2);
let r = await fetchShowtimes("https://in.bookmyshow.com/x/buytickets/ET1/20260924", "20260924", flaky.provider);
check("second attempt succeeded", r.reading.outcome, Outcome.OK_SHOWS);
check("five venues read", r.reading.venues.length, 5);
check("used a FRESH context each time", flaky.contexts(), 2);

console.log("\nA persistent block is reported honestly after the attempts run out");
const dead = fakeBrowser(99);
r = await fetchShowtimes("https://in.bookmyshow.com/x/buytickets/ET1/20260924", "20260924", dead.provider);
check("still blocked", r.reading.outcome, Outcome.BLOCKED);
check("tried three times", dead.contexts(), 3);
check("and never claims there are no shows", r.reading.venues.length, 0);

console.log("\nA clean read costs exactly one attempt");
const fine = fakeBrowser(1);
r = await fetchShowtimes("https://in.bookmyshow.com/x/buytickets/ET1/20260924", "20260924", fine.provider);
check("ok first time", r.reading.outcome, Outcome.OK_SHOWS);
check("no wasted requests", fine.contexts(), 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
