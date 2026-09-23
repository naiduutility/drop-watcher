/**
 * "Got it" — and, crucially, its undo.
 *
 * This endpoint is what the notification buttons point at, which means it will
 * be tapped from notifications hours old, twice by accident, and by whichever
 * browser prefetches things. So it is:
 *
 *   IDEMPOTENT — acking an acked subscription changes nothing and says so.
 *   SCOPED     — it only ever touches the caller's OWN subscription.
 *   REVERSIBLE — every response carries an undo link.
 *
 * On 2026-09-22 the equivalent action was an ntfy message: it silenced a whole
 * film for everyone on the topic, was re-applied from a 12-hour cache on every
 * run, and could only be undone by renaming the movie's id. Each property above
 * exists because one of those went wrong.
 */

import { eq } from "drizzle-orm";

import { db } from "../../../../db/index.js";
import { subscriptions } from "../../../../db/schema.js";
import { currentUserId, ownedSubscription } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

function page(title: string, body: string, undoHref: string | null) {
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <style>
       body{margin:0;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;background:#fbfbfa;color:#111}
       @media (prefers-color-scheme:dark){body{background:#16161a;color:#e8e8e6}}
       main{max-width:32rem;margin:0 auto;padding:3rem 1.25rem}
       a{color:#1a5fb4}@media (prefers-color-scheme:dark){a{color:#7aa2f7}}
       .btn{display:inline-block;margin-top:1rem;padding:.55rem .9rem;border-radius:8px;
            border:1px solid currentColor;text-decoration:none}
     </style>
     <main><h1>${title}</h1><p>${body}</p>
     ${undoHref ? `<a class="btn" href="${undoHref}">Undo</a>` : ""}
     <p style="margin-top:1.5rem"><a href="/">Your watches</a></p></main>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(id: string) {
  const userId = await currentUserId();
  if (!userId) {
    return page("Sign in first", "Open this from the device you claimed your invite on.", null);
  }
  // Not found and not-yours are answered identically: which subscription ids
  // exist is nobody else's business.
  const sub = await ownedSubscription(id, userId);
  if (!sub) return page("Not found", "That alert is not one of yours.", null);

  if (sub.ackedAt) {
    return page("Already silenced", "Nothing changed — this was already off.", `/s/${id}/unack`);
  }
  await db.update(subscriptions)
    .set({ state: "acked", ackedAt: new Date() })
    .where(eq(subscriptions.id, id));

  return page(
    "Silenced",
    "No more alerts for this date. Nobody else's alerts were touched.",
    `/s/${id}/unack`,
  );
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  return handle(ctx.params.id);
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  return handle(ctx.params.id);
}
