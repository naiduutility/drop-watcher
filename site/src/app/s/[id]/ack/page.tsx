import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { BellOff, Smartphone, Undo2 } from "lucide-react";

import { db } from "../../../../db/index.js";
import { subscriptions, targets } from "../../../../db/schema.js";
import { currentUserId } from "../../../../lib/auth.js";
import { dateParts } from "../../../../lib/view.js";
import { AppHeader } from "../../../../components/AppHeader.js";

export const dynamic = "force-dynamic";

/**
 * Where a notification's "Got it" button lands.
 *
 * It will be tapped from notifications hours old, twice by accident, and by
 * whatever prefetches links. So it is idempotent, scoped to the caller's own
 * watch, and every outcome offers Undo.
 *
 * What it silences depends on what the alert announced. An alert about AMB's
 * HDR By Barco carries that key and silences only that screen for that day —
 * the rest of the watch keeps running, so Prasads opening later still reaches
 * you. Only an alert with no narrowing at all silences the whole date, which
 * is the simple watch behaving as it always did.
 */
export default async function Ack({
  params, searchParams,
}: { params: { id: string }; searchParams: { k?: string | string[] } }) {
  const userId = await currentUserId();

  if (!userId) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-[640px] px-4 pb-10 pt-12">
          <Smartphone size={56} strokeWidth={2} />
          <h1 className="mt-5 text-[48px] font-extrabold leading-[.94] tracking-display">
            This phone isn&apos;t signed in.
          </h1>
          <p className="mt-4 text-[17px] leading-[1.5] text-neutral-800">
            So nothing was silenced, and your alerts for this date are still on. Pair this phone
            from one that&apos;s signed in, then tap the notification again.
          </p>
          <Link
            href="/devices/new"
            className="mt-6 flex min-h-[54px] items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white no-underline"
          >
            <span>How to pair this phone</span>
          </Link>
        </main>
      </>
    );
  }

  const [row] = await db
    .select({ sub: subscriptions, target: targets })
    .from(subscriptions)
    .innerJoin(targets, eq(subscriptions.targetId, targets.id))
    .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, userId)))
    .limit(1);

  if (!row) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-[640px] px-4 pb-10 pt-12">
          <h1 className="text-[44px] font-extrabold leading-[.96] tracking-tight2">Not found</h1>
          <p className="mt-3 text-[17px] text-neutral-800">That alert isn&apos;t one of yours.</p>
          <Link href="/" className="mt-6 inline-block text-[15px] font-extrabold text-accent-700">
            Your watches
          </Link>
        </main>
      </>
    );
  }

  const keys = (Array.isArray(searchParams.k) ? searchParams.k : searchParams.k ? [searchParams.k] : [])
    .map((k) => k.toLowerCase())
    .filter(Boolean);

  const already = keys.length > 0
    ? keys.every((k) => row.sub.ackedKeys.includes(k))
    : Boolean(row.sub.ackedAt);

  if (!already) {
    if (keys.length > 0) {
      // Merged in JS: Drizzle interpolates a JS array as a record, which
      // Postgres will not cast to text[]. The row is already loaded, so there
      // is nothing to gain from doing it in SQL.
      await db.update(subscriptions)
        .set({ ackedKeys: [...new Set([...row.sub.ackedKeys, ...keys])] })
        .where(eq(subscriptions.id, params.id));
    } else {
      await db.update(subscriptions)
        .set({ state: "acked", ackedAt: new Date() })
        .where(eq(subscriptions.id, params.id));
    }
  }

  const when = dateParts(row.sub.showDate);
  // "AMB Cinemas — HDR By Barco", reconstructed from the key so the screen
  // says exactly what went quiet rather than a vague "this date".
  const what = keys.length > 0
    ? keys.map((k) => {
        const screen = k.split("|")[1];
        return screen && screen !== "*" ? screen : "that cinema";
      }).join(", ")
    : null;

  const undoHref = keys.length > 0
    ? `/s/${params.id}/unack?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`
    : `/s/${params.id}/unack`;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[640px] flex-col px-4 pb-4 pt-12">
        <div className="flex-1">
          <BellOff size={56} strokeWidth={2} />
          <h1 className="mt-5 text-[64px] font-extrabold leading-[.9] tracking-display">
            {already ? "Already silenced." : "Silenced."}
          </h1>

          <div className="mt-6 border-t-2 border-ink pt-3">
            <span className="block text-xl font-extrabold tracking-tight1">{row.target.title}</span>
            <span className="mt-0.5 block text-[15px] text-neutral-700">
              {when.short} · {row.target.city}
              {what ? ` · ${what}` : ""}
            </span>
          </div>
          <div className="border-b-2 border-divider" />

          <p className="mt-5 text-[17px] leading-[1.5] text-neutral-800">
            {already
              ? "You'd already told us to stop for this. Nothing changed."
              : what
                ? `No more alerts for ${what} on ${when.short}. The rest of this watch keeps running — if another cinema opens, you'll hear about it.`
                : "No more alerts for this date. Only yours: friends watching it still get theirs."}
          </p>
        </div>

        <div className="sticky bottom-0 bg-bg pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
          <form action={undoHref} method="post">
            <button
              type="submit"
              className="flex min-h-[64px] w-full items-center justify-between bg-ink px-4 text-xl font-extrabold text-bg transition-transform duration-75 active:scale-[.98]"
            >
              <span>{already ? "Watch again" : "Undo"}</span>
              <Undo2 size={22} strokeWidth={2.5} />
            </button>
          </form>
          <Link
            href="/"
            className="mt-2 flex min-h-[44px] items-center justify-center text-[15px] font-extrabold text-neutral-700 no-underline"
          >
            See all your watches
          </Link>
        </div>
      </main>
    </>
  );
}
