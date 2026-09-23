/**
 * Reading environment variables that come from GitHub secrets.
 *
 * GitHub Actions sets an UNDEFINED secret to an empty string, not to nothing.
 * So the obvious spelling is wrong:
 *
 *   process.env.NTFY_SERVER ?? "https://ntfy.sh"   // "" — ?? only catches null
 *   Number(process.env.PACING_MS ?? 6000)          // Number("") === 0
 *
 * The first shipped, and every notification failed with "Failed to parse URL
 * from /". The second would have been worse: pacing silently set to zero,
 * hammering an IP that BookMyShow is already rate limiting, with nothing in
 * the log to say so.
 *
 * check.py had learned this and said so in a comment. This module exists so
 * the lesson survives the rewrite instead of being rediscovered in production.
 */

/** A non-empty string from the environment, or the fallback. */
export function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : fallback;
}

/** A finite number from the environment, or the fallback. */
export function envNumber(name: string, fallback: number): number {
  const raw = envString(name, "");
  if (raw.length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** A URL with any trailing slashes removed, so `${base}/path` is never `//`. */
export function envBaseUrl(name: string, fallback: string): string {
  return envString(name, fallback).replace(/\/+$/, "");
}
