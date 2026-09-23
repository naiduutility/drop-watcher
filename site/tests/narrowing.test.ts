/**
 * Explaining why a narrowed watch is quiet.
 *
 * Picking one auditorium gives silence a second meaning: the film may be on
 * sale at that cinema and simply not in that room. That is the same ambiguity
 * this project spent days removing, reintroduced by a feature we added on
 * purpose — so it has to be visible, and it has to be tested.
 */

import { listedButNotMine, narrowingReport, wrongScreens } from "../src/lib/narrowing.js";
import type { Venue } from "../src/engine/index.js";

const AMB: Venue = {
  code: "AMBH", name: "AMB Cinemas: Gachibowli",
  screens: ["English • 2D | BARCO FLAGSHIP LASER DOLBY ATMOS"],
};
const PRASADS: Venue = {
  code: "PRHN", name: "Prasads Multiplex: Hyderabad",
  screens: ["English • 3D | PCX Infinity Vis 3D", "English • 2D | HDR By Barco"],
};
const LISTED = [AMB, PRASADS];

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log("\nThe case that used to be a silent miss");
let report = narrowingReport([{ code: "AMBH", screens: ["HDR By Barco"] }], LISTED);
check("AMB is listed, but not on the screen asked for", report[0]!.kind, "wrong_screen");
check("and it says what IS running there",
  report[0]!.kind === "wrong_screen" ? report[0]!.running : [],
  ["BARCO FLAGSHIP LASER DOLBY ATMOS"]);
check("naming the cinema properly", report[0]!.name, "AMB Cinemas: Gachibowli");
check("flagged for telling somebody", wrongScreens(report).length, 1);
check("and the watch knows it cannot fire",
  listedButNotMine([{ code: "AMBH", screens: ["HDR By Barco"] }], [], LISTED), true);

console.log("\nThe same screen at the cinema that actually has it");
report = narrowingReport([{ code: "PRHN", screens: ["HDR By Barco"] }], LISTED);
check("matched", report[0]!.kind, "matched");
check("nothing to warn about", wrongScreens(report).length, 0);
check("watch can fire", listedButNotMine([{ code: "PRHN", screens: ["HDR By Barco"] }], [], LISTED), false);

console.log("\nA cinema simply not listed is ordinary waiting, not a miss");
report = narrowingReport([{ code: "ALUC", screens: ["Dolby Cinema"] }], LISTED);
check("not_listed, never wrong_screen", report[0]!.kind, "not_listed");
check("no warning", wrongScreens(report).length, 0);

console.log("\nNothing on sale at all: every pick is just waiting");
report = narrowingReport([{ code: "AMBH", screens: ["HDR By Barco"] }], []);
check("not_listed", report[0]!.kind, "not_listed");
check("never claims the room was busy with something else", wrongScreens(report).length, 0);
check("and raises no alarm", listedButNotMine([{ code: "AMBH", screens: ["HDR By Barco"] }], [], []), false);

console.log("\nA cinema picked with no screen narrowing matches on any screen");
report = narrowingReport([{ code: "AMBH", screens: [] }], LISTED);
check("matched", report[0]!.kind, "matched");
check("listing what it is running", report[0]!.kind === "matched" ? report[0]!.screens : [],
  ["BARCO FLAGSHIP LASER DOLBY ATMOS"]);

console.log("\nSeveral cinemas: one match is enough to keep quiet");
check("AMB wrong screen but Prasads right: watch can fire",
  listedButNotMine(
    [{ code: "AMBH", screens: ["HDR By Barco"] }, { code: "PRHN", screens: ["HDR By Barco"] }],
    [], LISTED,
  ), false);
check("both wrong: the watch cannot fire",
  listedButNotMine(
    [{ code: "AMBH", screens: ["IMAX"] }, { code: "PRHN", screens: ["IMAX"] }],
    [], LISTED,
  ), true);

console.log("\nCity-wide screen filters, no cinema picked");
check("a format nobody runs: listed but not mine",
  listedButNotMine([], ["IMAX"], LISTED), true);
check("a format somebody runs: fine", listedButNotMine([], ["HDR By Barco"], LISTED), false);
check("no narrowing at all is never 'not mine'", listedButNotMine([], [], LISTED), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
