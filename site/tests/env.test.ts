/**
 * Environment reading, and the empty-string trap that reached production.
 *
 * GitHub Actions sets an undefined secret to "", not to nothing. The first
 * live worker run failed every notification with "Failed to parse URL from /"
 * because `process.env.NTFY_SERVER ?? "https://ntfy.sh"` kept the empty
 * string. check.py had a comment warning about exactly this; the rewrite
 * reintroduced it. These tests are so it cannot come back a third time.
 */

import { envBaseUrl, envNumber, envString } from "../src/lib/env.js";

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++; console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const KEY = "DW_TEST_VAR";
function withEnv<T>(value: string | undefined, fn: () => T): T {
  const before = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env[KEY];
    else process.env[KEY] = before;
  }
}

console.log("\nAn unset secret and an empty secret must behave the same");
check("unset falls back", withEnv(undefined, () => envString(KEY, "fallback")), "fallback");
check("empty falls back", withEnv("", () => envString(KEY, "fallback")), "fallback");
check("whitespace falls back", withEnv("   ", () => envString(KEY, "fallback")), "fallback");
check("a real value is used", withEnv("real", () => envString(KEY, "fallback")), "real");
check("a real value is trimmed", withEnv("  real\n", () => envString(KEY, "fallback")), "real");

console.log("\nNumbers: Number(\"\") is 0, which would silently remove pacing");
check("unset falls back", withEnv(undefined, () => envNumber(KEY, 6000)), 6000);
check("empty falls back, NOT 0", withEnv("", () => envNumber(KEY, 6000)), 6000);
check("nonsense falls back, NOT NaN", withEnv("soon", () => envNumber(KEY, 6000)), 6000);
check("a real number is used", withEnv("250", () => envNumber(KEY, 6000)), 250);
check("an explicit zero is honoured", withEnv("0", () => envNumber(KEY, 6000)), 0);

console.log("\nBase URLs: the actual production failure");
check("empty gives the default, not \"\"",
  withEnv("", () => envBaseUrl(KEY, "https://ntfy.sh")), "https://ntfy.sh");
check("trailing slash removed, so base + / is never //",
  withEnv("https://example.com/", () => envBaseUrl(KEY, "x")), "https://example.com");
check("several trailing slashes removed",
  withEnv("https://example.com///", () => envBaseUrl(KEY, "x")), "https://example.com");
check("the exact broken case now yields a parseable URL",
  withEnv("", () => new URL("/", envBaseUrl(KEY, "https://ntfy.sh") + "/").href),
  "https://ntfy.sh/");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
