/**
 * Scheduling and transition policy.
 *
 * The final section replays 2026-09-22 against the new design, minute by
 * minute, and asserts the two things that actually went wrong cannot happen:
 * the false "shows are UP", and the silence nobody could explain.
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readShowtimes } from "../src/engine/index.js";
import {
  BASE_INTERVAL_MS, MAX_BACKOFF_MS, nextDueDelayMs, planFetches,
} from "../src/core/schedule.js";
import {
  DEFAULT_POLICY, planEvents,
  type SubscriptionView, type TargetView,
} from "../src/core/transitions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "tests", "fixtures");
const fixture = (n: string) =>
  gunzipSync(readFileSync(join(FIXTURES, n))).toString("utf8");
const KAKINADA_24TH = fixture("kakinada-20260924-real.html.gz");
const BLOCKED_PAGE = fixture("cloudflare-403.html.gz");

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const MINUTE = 60_000;
const target: TargetView = {
  id: "t1", title: "The Paradise", city: "Kakinada",
  lastOkAt: null, degradedNotifiedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};
const sub = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: "s1", userId: "u1", showDate: "20260923",
  cinemaCodes: [], screenFilter: null, state: "armed",
  firedAt: null, remindersSent: 0, ...over,
});

console.log("\nPacing: cold targets must not spend the request budget");
check("hot polls every 2 min", BASE_INTERVAL_MS.hot, 2 * MINUTE);
check("cold polls hourly, not every 5 min", BASE_INTERVAL_MS.cold, 60 * MINUTE);
check("healthy hot delay, mid jitter",
  nextDueDelayMs({ priority: "hot", consecutiveInconclusive: 0, now: new Date(), random: 0.5 }),
  2 * MINUTE);
check("jitter spreads the herd (r=0 is 80%)",
  nextDueDelayMs({ priority: "hot", consecutiveInconclusive: 0, now: new Date(), random: 0 }),
  0.8 * 2 * MINUTE);

console.log("\nBackoff after Cloudflare blocks");
const blockedDelay = (n: number) =>
  nextDueDelayMs({ priority: "hot", consecutiveInconclusive: n, now: new Date(), random: 0.5 });
check("1 block doubles", blockedDelay(1), 4 * MINUTE);
check("3 blocks -> 16 min", blockedDelay(3), 16 * MINUTE);
check("never sleeps past the cap", blockedDelay(10), MAX_BACKOFF_MS);
check("cap is under half an hour", MAX_BACKOFF_MS <= 30 * MINUTE, true);

console.log("\nFetch planning: ask for as little as possible");
check("nothing armed, nothing fetched",
  planFetches({ armedDates: [], offeredDates: ["20260924"] }), []);
check("premiere: exactly one request, though the strip lacks the date",
  planFetches({ armedDates: ["20260923"], offeredDates: ["20260924", "20260925"] }),
  ["20260923"]);
check("a date known NOT on sale costs no extra request",
  planFetches({ armedDates: ["20260923", "20260930"], offeredDates: ["20260924"] }),
  ["20260923"]);
check("a second armed date already on sale is worth fetching",
  planFetches({ armedDates: ["20260925", "20260926"], offeredDates: ["20260925", "20260926"] }),
  ["20260925", "20260926"]);
check("unknown strip: still polls the earliest",
  planFetches({ armedDates: ["20260923"], offeredDates: [] }), ["20260923"]);

console.log("\nTHE FALSE ALERT (17:26) - the 24th's venues, requested as the 23rd");
let reading = readShowtimes(KAKINADA_24TH, { requestedDate: "20260923" });
let events = planEvents({ target, subscriptions: [sub()], reading, now: new Date() });
check("no events at all", events.length, 0);
check("specifically, no on_sale", events.filter((e) => e.kind === "on_sale").length, 0);

console.log("\nThe same read, for the date it really is");
reading = readShowtimes(KAKINADA_24TH, { requestedDate: "20260924" });
events = planEvents({
  target, subscriptions: [sub({ showDate: "20260924" })], reading, now: new Date(),
});
check("one on_sale", events.length, 1);
check("carries the five venues",
  events[0]!.kind === "on_sale" ? events[0]!.venues.length : -1, 5);

console.log("\nA subscription for another date is never told");
events = planEvents({
  target, subscriptions: [sub({ showDate: "20260926" })], reading, now: new Date(),
});
check("silent", events.length, 0);

console.log("\nVenue-specific watch only fires for its own venue");
const venueSub = (...codes: string[]) => sub({ showDate: "20260924", cinemaCodes: codes });
check("INOX watcher fires",
  planEvents({ target, subscriptions: [venueSub("INMT")], reading, now: new Date() }).length, 1);
check("a cinema not running it stays quiet",
  planEvents({ target, subscriptions: [venueSub("PVFS")], reading, now: new Date() }).length, 0);
check("picking nothing means every cinema",
  planEvents({ target, subscriptions: [sub({ showDate: "20260924", cinemaCodes: [] })], reading, now: new Date() }).length, 1);
check("a screen nobody is running stays quiet",
  planEvents({ target, subscriptions: [sub({ showDate: "20260924", screenFilter: "4DX" })], reading, now: new Date() }).length, 0);

console.log("\nAn acked subscription is never re-fired (and the ack is one person's)");
events = planEvents({
  target,
  subscriptions: [sub({ showDate: "20260924", state: "acked" }),
                  sub({ id: "s2", userId: "u2", showDate: "20260924" })],
  reading, now: new Date(),
});
check("only the other person hears about it", events.length, 1);
check("and it is u2", events[0]!.kind === "on_sale" ? events[0]!.userId : "", "u2");

console.log("\nReminders: one nudge, not one every five minutes");
const now = new Date("2026-09-24T12:00:00Z");
const firedAt = new Date(now.getTime() - 11 * MINUTE);
check("nudged once after 10 min unacked",
  planEvents({ target, subscriptions: [sub({ showDate: "20260924", state: "fired", firedAt })], reading, now })
    .filter((e) => e.kind === "reminder").length, 1);
check("not nudged at 2 min",
  planEvents({
    target,
    subscriptions: [sub({ showDate: "20260924", state: "fired", firedAt: new Date(now.getTime() - 2 * MINUTE) })],
    reading, now,
  }).length, 0);
check("stops after maxReminders",
  planEvents({
    target,
    subscriptions: [sub({ showDate: "20260924", state: "fired", firedAt, remindersSent: DEFAULT_POLICY.maxReminders })],
    reading, now,
  }).length, 0);

console.log("\nTHE SILENCE - blocked reads must announce themselves");
const blocked = readShowtimes(BLOCKED_PAGE, {
  bodyText: BLOCKED_PAGE, requestedDate: "20260923", httpStatus: 403,
});
check("a single block is not yet alarming",
  planEvents({
    target: { ...target, lastOkAt: new Date(now.getTime() - 3 * MINUTE) },
    subscriptions: [sub()], reading: blocked, now,
  }).length, 0);
const degraded = planEvents({
  target: { ...target, lastOkAt: new Date(now.getTime() - 40 * MINUTE) },
  subscriptions: [sub()], reading: blocked, now,
});
check("40 min without a real read raises degraded", degraded.length, 1);
check("it is a degraded event", degraded[0]!.kind, "degraded");
check("and it names the person still waiting",
  degraded[0]!.kind === "degraded" ? degraded[0]!.userIds : [], ["u1"]);
check("never repeats within the quiet period",
  planEvents({
    target: {
      ...target,
      lastOkAt: new Date(now.getTime() - 40 * MINUTE),
      degradedNotifiedAt: new Date(now.getTime() - 5 * MINUTE),
    },
    subscriptions: [sub()], reading: blocked, now,
  }).length, 0);
check("nobody waiting, nobody bothered",
  planEvents({
    target: { ...target, lastOkAt: new Date(now.getTime() - 40 * MINUTE) },
    subscriptions: [sub({ state: "acked" })], reading: blocked, now,
  }).length, 0);

console.log("\nA brand-new target does not cry wolf on its first blocked read");
check("silent while younger than the degraded window",
  planEvents({
    target: { ...target, lastOkAt: null, createdAt: new Date(now.getTime() - 2 * MINUTE) },
    subscriptions: [sub()], reading: blocked, now,
  }).length, 0);
check("but warns once it has been failing long enough",
  planEvents({
    target: { ...target, lastOkAt: null, createdAt: new Date(now.getTime() - 90 * MINUTE) },
    subscriptions: [sub()], reading: blocked, now,
  }).length, 1);

console.log("\nA conclusive 'not on sale' is healthy silence, not degradation");
const notOnSale = readShowtimes(KAKINADA_24TH, { requestedDate: "20260923" });
check("DATE_FALLBACK raises nothing, however old lastOkAt is",
  planEvents({
    target: { ...target, lastOkAt: new Date(now.getTime() - 5 * 60 * MINUTE) },
    subscriptions: [sub()], reading: notOnSale, now,
  }).length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
