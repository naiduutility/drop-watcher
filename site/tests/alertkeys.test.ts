/**
 * Per-screen, per-day alerting and silencing.
 *
 * A date goes on sale one cinema at a time. Before this, whichever multiplex
 * listed first decided whether you ever heard about PCX at Prasads — it fired
 * once, and "Got it" silenced the whole date. check.py acknowledged per
 * theatre per day; these tests pin the finer version of that.
 */

import { describe, matchedTargets, unannounced, liveTargets, WHOLE_DATE } from "../src/lib/alertkeys.js";
import { planEvents, type SubscriptionView, type TargetView } from "../src/core/transitions.js";
import { Outcome, type Reading, type Venue } from "../src/engine/index.js";

const AMB: Venue = {
  code: "AMBH", name: "AMB Cinemas: Gachibowli",
  screens: ["English • 2D | HDR By Barco", "English • 3D | BARCO FLAGSHIP"],
};
const PRASADS: Venue = {
  code: "PRHN", name: "Prasads Multiplex: Hyderabad",
  screens: ["English • 3D | PCX Infinity Vis 3D"],
};

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const PICKS = [
  { code: "AMBH", screens: ["HDR By Barco"] },
  { code: "PRHN", screens: ["PCX"] },
];

console.log("\nOne key per screen you actually asked for and that is running");
let targets = matchedTargets(PICKS, [], [AMB]);
check("only AMB is listed, so only AMB has a key", targets.length, 1);
check("and it names the screen", targets[0]!.screen, "HDR By Barco");
check("readable", describe(targets[0]!), "AMB Cinemas — HDR By Barco");

targets = matchedTargets(PICKS, [], [AMB, PRASADS]);
check("both listed: two keys", targets.map((t) => t.key),
  ["ambh|hdr by barco", "prhn|pcx"]);

console.log("\nNo narrowing at all stays one key, so simple watches stay simple");
check("one key for the date", matchedTargets([], [], [AMB, PRASADS]).map((t) => t.key), [WHOLE_DATE]);
check("nothing listed, nothing to say", matchedTargets([], [], []).length, 0);

console.log("\nAlready announced is not announced again");
targets = matchedTargets(PICKS, [], [AMB, PRASADS]);
check("both fresh at first", unannounced(targets, [], []).length, 2);
check("AMB told: only Prasads left",
  unannounced(targets, ["ambh|hdr by barco"], []).map((t) => t.code), ["PRHN"]);
check("a silenced key is never re-announced",
  unannounced(targets, [], ["ambh|hdr by barco"]).map((t) => t.code), ["PRHN"]);
check("all done: silence", unannounced(targets, ["ambh|hdr by barco", "prhn|pcx"], []).length, 0);

console.log("\nReminders only nudge about what is still live");
check("a silenced screen never returns via the reminder",
  liveTargets(targets, ["ambh|hdr by barco"]).map((t) => t.code), ["PRHN"]);

console.log("\nEND TO END: the second cinema is news, even after the first fired");
const target: TargetView = {
  id: "t1", title: "Avengers", city: "Hyderabad",
  lastOkAt: new Date(), degradedNotifiedAt: null, createdAt: new Date("2026-09-01"),
};
const sub = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: "s1", userId: "u1", showDate: "20260926",
  cinemaPicks: PICKS, screenFilters: [], state: "armed",
  firedAt: null, remindersSent: 0, notifiedKeys: [], ackedKeys: [], ...over,
});
const reading = (venues: Venue[]): Reading => ({
  outcome: Outcome.OK_SHOWS, requestedDate: "20260926", servedDate: "20260926",
  offeredDates: ["20260926"], venues, detail: "",
});
const fire = (s: SubscriptionView, venues: Venue[]) =>
  planEvents({ target, subscriptions: [s], reading: reading(venues), now: new Date() });

let events = fire(sub(), [AMB]);
check("AMB opens: one alert", events.length, 1);
check("naming only AMB",
  events[0]!.kind === "on_sale" ? events[0]!.venues.map((v) => v.code) : [], ["AMBH"]);

const told = sub({ state: "fired", firedAt: new Date(), notifiedKeys: ["ambh|hdr by barco"] });
check("AMB again, nothing new: silence", fire(told, [AMB]).length, 0);

events = fire(told, [AMB, PRASADS]);
check("Prasads opens later: a SECOND alert", events.length, 1);
check("about Prasads only",
  events[0]!.kind === "on_sale" ? events[0]!.venues.map((v) => v.code) : [], ["PRHN"]);

console.log("\nSilencing one screen leaves the other watched");
const hushed = sub({
  state: "fired", firedAt: new Date(),
  notifiedKeys: ["ambh|hdr by barco"], ackedKeys: ["ambh|hdr by barco"],
});
check("AMB stays quiet", fire(hushed, [AMB]).length, 0);
events = fire(hushed, [AMB, PRASADS]);
check("but Prasads still alerts", events.length, 1);
check("about Prasads",
  events[0]!.kind === "on_sale" ? events[0]!.venues.map((v) => v.code) : [], ["PRHN"]);

console.log("\nSilencing the whole watch still silences everything");
check("state acked beats any key",
  fire(sub({ state: "acked" }), [AMB, PRASADS]).length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
