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

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../../db/index.js";
import { subscriptions } from "../../../../db/schema.js";
import { currentUserId } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

async function handle(req: Request, id: string) {
  const userId = await currentUserId();
  if (!userId) return Response.redirect(new URL("/", req.url), 303);

  const keys = new URL(req.url).searchParams.getAll("k").map((k) => k.toLowerCase()).filter(Boolean);

  if (keys.length > 0) {
    // Also drop them from notifiedKeys, so the next read announces the screen
    // again rather than treating it as old news and staying silent forever.
    await db.update(subscriptions)
      .set({
        ackedKeys: sql`array(select k from unnest(${subscriptions.ackedKeys}) k where k <> all(${keys}::text[]))`,
        notifiedKeys: sql`array(select k from unnest(${subscriptions.notifiedKeys}) k where k <> all(${keys}::text[]))`,
      })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));
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
