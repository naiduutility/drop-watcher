/**
 * Undo.
 *
 * The single most important route in the application, because its absence is
 * what made 2026-09-22 unrecoverable: one tap silenced a watch and nothing
 * short of renaming the movie's id could bring it back.
 *
 * Re-arming resets the alert lifecycle rather than merely clearing the ack —
 * a subscription left in "fired" would be considered already told and would
 * never alert again.
 */

import { eq } from "drizzle-orm";

import { db } from "../../../../db/index.js";
import { subscriptions } from "../../../../db/schema.js";
import { currentUserId, ownedSubscription } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

function page(title: string, body: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <style>
       body{margin:0;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;background:#fbfbfa;color:#111}
       @media (prefers-color-scheme:dark){body{background:#16161a;color:#e8e8e6}}
       main{max-width:32rem;margin:0 auto;padding:3rem 1.25rem}
       a{color:#1a5fb4}@media (prefers-color-scheme:dark){a{color:#7aa2f7}}
     </style>
     <main><h1>${title}</h1><p>${body}</p>
     <p style="margin-top:1.5rem"><a href="/">Your watches</a></p></main>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(id: string) {
  const userId = await currentUserId();
  if (!userId) return page("Sign in first", "Open this on the device you claimed your invite on.");

  const sub = await ownedSubscription(id, userId);
  if (!sub) return page("Not found", "That alert is not one of yours.");

  await db.update(subscriptions)
    .set({ state: "armed", ackedAt: null, firedAt: null, remindersSent: 0 })
    .where(eq(subscriptions.id, id));

  return page("Watching again", "You will be told when this date is on sale.");
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  return handle(ctx.params.id);
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  return handle(ctx.params.id);
}
