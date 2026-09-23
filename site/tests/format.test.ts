/**
 * Reading screen formats, and why the dimension is thrown away.
 *
 * A premium auditorium shows whatever the distributor sends it. AMB's HDR By
 * Barco might run a film in 2D this week and 3D the next, and someone watching
 * "the best screen in the city" means the room, not the projection. Offering
 * "2D | HDR By Barco" as a choice would miss a 3D show in the same seat.
 */

import { dimension, formatChoices, screenName } from "../src/lib/format.js";
import { screenMatches } from "../src/engine/index.js";

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const HDR_2D = "English • 2D | HDR By Barco";
const HDR_3D = "English • 3D | HDR By Barco";
const IVDA = "English • 2D | INFINITY VISION DOLBY ATMOS";
const PLAIN = "Telugu • 2D";
const FOURDX = "English • 4DX 3D | 4DX";

console.log("\nThe screen is the auditorium, not the projection");
check("takes what follows the pipe", screenName(HDR_2D), "HDR By Barco");
check("same room, different dimension", screenName(HDR_3D), "HDR By Barco");
check("longer screen names survive intact", screenName(IVDA), "INFINITY VISION DOLBY ATMOS");
check("no screen given: falls back to the dimension", screenName(PLAIN), "2D");
check("4DX", screenName(FOURDX), "4DX");

console.log("\nThe dimension is read, but only so it can be discarded");
check("2D", dimension(HDR_2D), "2D");
check("3D", dimension(HDR_3D), "3D");
check("4DX 3D", dimension(FOURDX), "4DX 3D");
check("none when there is no bullet", dimension("HDR By Barco"), null);

console.log("\nOne chip per room, however many dimensions it has run");
check("HDR By Barco appears once, not twice",
  formatChoices([HDR_2D, HDR_3D]), ["HDR By Barco"]);
check("distinct rooms stay distinct",
  formatChoices([HDR_2D, IVDA, FOURDX]),
  ["HDR By Barco", "INFINITY VISION DOLBY ATMOS", "4DX"]);
check("case differences are not new rooms",
  formatChoices([HDR_2D, "English • 3D | HDR BY BARCO"]), ["HDR By Barco"]);
check("nothing is filtered out by a format word list",
  formatChoices([HDR_2D]).length, 1);

console.log("\nTHE POINT: a watch on the room catches either dimension");
const venue2D = { code: "AMBH", name: "AMB Cinemas", screens: [HDR_2D] };
const venue3D = { code: "AMBH", name: "AMB Cinemas", screens: [HDR_3D] };
const other = { code: "PRHN", name: "Prasads", screens: [IVDA] };
check("picked from the 2D listing, still matches the 3D show",
  screenMatches(screenName(HDR_2D), venue3D), true);
check("and still matches the 2D one", screenMatches(screenName(HDR_2D), venue2D), true);
check("but not a different room", screenMatches(screenName(HDR_2D), other), false);
check("PCX-style names match case-insensitively",
  screenMatches("PCX", { code: "X", name: "X", screens: ["Telugu • 2D | PCX SCREEN"] }), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
