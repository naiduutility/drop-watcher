/**
 * Undo.
 *
 * Kept as a route rather than a page because it only ever redirects: the watch
 * detail screen is a better place to land than another confirmation. Its
 * absence is what made 2026-09-22 unrecoverable, so it accepts both GET and
 * POST — a stale notification button must never find a dead end here.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../../../../db/index.js";
import { subscriptions } from "../../../../db/schema.js";
import { currentUserId } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

async function handle(req: Request, id: string) {
  const userId = await currentUserId();
  const home = new URL("/", req.url);
  if (!userId) return Response.redirect(home, 303);

  // Re-arming resets the whole lifecycle: a subscription left "fired" counts
  // as already told and would never alert again.
  await db.update(subscriptions)
    .set({ state: "armed", ackedAt: null, firedAt: null, remindersSent: 0 })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));

  return Response.redirect(new URL(`/w/${id}`, req.url), 303);
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return handle(req, ctx.params.id);
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  return handle(req, ctx.params.id);
}
