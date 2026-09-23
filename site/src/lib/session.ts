/**
 * Sessions, kept deliberately small.
 *
 * For a group of trusted friends behind single-use invites, a signed cookie is
 * enough: no passwords to reset, no email provider, no identity service. The
 * cookie says who you are and when it stops being true, and an HMAC says we
 * issued it.
 *
 * What this is NOT: an authorisation system. Every route still checks that the
 * subscription it is about to change belongs to the session's user — a signed
 * cookie proves identity, never entitlement.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dw_session";
/** Long-lived on purpose: losing it means asking an admin for a new invite,
 *  which for this group is a smaller cost than a login flow nobody wanted. */
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(userId: string, expiresAt: number, secret: string): string {
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${hmac(payload, secret)}`;
}

/**
 * The user id in a valid, unexpired token — or null.
 *
 * Compared with timingSafeEqual rather than `===`: string comparison returns
 * early on the first differing byte, which leaks how much of a forged
 * signature was right.
 */
export function verifySession(
  token: string | undefined | null, secret: string, now = Date.now(),
): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf(".");
  if (cut < 1) return null;
  const payload = token.slice(0, cut);
  const given = token.slice(cut + 1);
  const expected = hmac(payload, secret);

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const dot = payload.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = payload.slice(0, dot);
  const expiresAt = Number(payload.slice(dot + 1));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return userId;
}

/**
 * A per-person ntfy topic.
 *
 * On ntfy.sh the topic name IS the password, so this is long and random and
 * never shared between people. Per-user topics are also what make one member's
 * tap unable to affect anyone else.
 */
export function randomTopic(): string {
  return "dw-" + randomBytes(16).toString("base64url").toLowerCase().replace(/[_-]/g, "");
}

/** Invite tokens: unguessable, since possession is the whole claim. */
export function randomInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The signing secret.
 *
 * Fails loudly rather than defaulting: a hardcoded fallback would mean anyone
 * reading this public repo could mint a session cookie for any user id.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return secret;
}
