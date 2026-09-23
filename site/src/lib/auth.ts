/**
 * Who is asking, and what they are allowed to touch.
 *
 * Two separate questions, deliberately two separate functions. A signed cookie
 * proves identity and nothing else: every route that changes a subscription
 * must also prove that subscription belongs to the caller. Getting that wrong
 * would reintroduce, through the front door, precisely the failure this whole
 * rebuild exists to remove — one person's action silencing another's alert.
 */

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { subscriptions, users } from "../db/schema.js";
import { SESSION_COOKIE, sessionSecret, verifySession } from "./session.js";

export async function currentUserId(): Promise<string | null> {
  return verifySession(cookies().get(SESSION_COOKIE)?.value, sessionSecret());
}

export async function currentUser() {
  const id = await currentUserId();
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

/**
 * A subscription, but only if it is the caller's own.
 *
 * Returns null for "does not exist" and for "belongs to someone else" alike —
 * the difference is not the caller's business, and telling them apart would
 * leak which subscription ids are real.
 */
export async function ownedSubscription(subscriptionId: string, userId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export function setSessionCookie(token: string, maxAgeMs: number) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}
