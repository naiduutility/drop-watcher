/**
 * Undo.
 *
 * Its absence is what made 2026-09-22 unrecoverable, so it accepts both GET
 * and POST — a stale notification button must never find a dead end at the one
 * action that makes an accidental tap survivable.
 *
 * With `?k=` it un-silences only those cinema+screen keys. Without, it
 * re-arms the whole watch, which also clears every per-screen silence: asking
 * to watch this date again cannot sensibly leave some screens muted.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../../../../db/index.js";
import { subscriptions } from "../../../../db/schema.js";
import { currentUserId } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

async function handle(req: Request, id: string) {
  const userId = await currentUserId();
  if (!userId) return Response.redirect(new URL("/", req.url), 303);

  const keys = new URL(req.url).searchParams.getAll("k")
    .map((k) => k.toLowerCase())
    .filter(Boolean);

  if (keys.length > 0) {
    // Read, filter in JS, write back. Drizzle interpolates a JS array as a
    // record — "(a, b, c)" — which Postgres refuses to cast to text[], so
    // doing this in SQL fails at runtime rather than at compile time.
    const [row] = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!row) return Response.redirect(new URL("/", req.url), 303);

    const drop = new Set(keys);
    await db.update(subscriptions)
      .set({
        ackedKeys: row.ackedKeys.filter((k) => !drop.has(k)),
        // Also forgotten as "announced", so the next read treats the screen as
        // news again rather than old business and stays silent forever.
        notifiedKeys: row.notifiedKeys.filter((k) => !drop.has(k)),
      })
      .where(eq(subscriptions.id, id));
  } else {
    // Re-arming resets the whole lifecycle: a subscription left "fired" counts
    // as already told and would never alert again.
    await db.update(subscriptions)
      .set({
        state: "armed", ackedAt: null, firedAt: null, remindersSent: 0,
        ackedKeys: [], notifiedKeys: [],
      })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));
  }

  return Response.redirect(new URL(`/w/${id}`, req.url), 303);
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return handle(req, ctx.params.id);
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  return handle(req, ctx.params.id);
}
