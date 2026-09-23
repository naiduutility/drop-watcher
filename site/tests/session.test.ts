/**
 * Session signing, and the forgeries it must refuse.
 */

import { randomTopic, signSession, verifySession } from "../src/lib/session.js";

const SECRET = "a".repeat(40);
const OTHER = "b".repeat(40);
const USER = "11111111-2222-3333-4444-555555555555";
const NOW = 1_700_000_000_000;
const SOON = NOW + 60_000;

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log("\nA session we issued is accepted");
const token = signSession(USER, SOON, SECRET);
check("round trips to the same user", verifySession(token, SECRET, NOW), USER);

console.log("\nEverything else is refused");
check("expired", verifySession(token, SECRET, SOON + 1), null);
check("signed with another secret", verifySession(token, OTHER, NOW), null);
check("missing", verifySession(undefined, SECRET, NOW), null);
check("empty", verifySession("", SECRET, NOW), null);
check("no signature", verifySession(`${USER}.${SOON}`, SECRET, NOW), null);
check("garbage", verifySession("nonsense", SECRET, NOW), null);

console.log("\nThe interesting forgery: keep the signature, change the user");
const tampered = token.replace(USER, "99999999-2222-3333-4444-555555555555");
check("refused", verifySession(tampered, SECRET, NOW), null);

console.log("\nAnd: keep the signature, extend the expiry");
const extended = signSession(USER, SOON, SECRET).replace(String(SOON), String(SOON + 9e9));
check("refused", verifySession(extended, SECRET, NOW), null);

console.log("\nTopics are unguessable, because on ntfy the name is the password");
const topics = new Set(Array.from({ length: 200 }, () => randomTopic()));
check("200 topics, no collisions", topics.size, 200);
check("long enough to not be brute-forced", randomTopic().length >= 20, true);
check("url-safe", /^[a-z0-9]+$/.test(randomTopic().replace(/^dw-/, "")), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
