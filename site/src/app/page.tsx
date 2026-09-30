import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { ArrowUpRight, Bell, Plus } from "lucide-react";

import { currentUser } from "../lib/auth.js";
import { db } from "../db/index.js";
import { channels, subscriptions, targetDates, targets, users } from "../db/schema.js";
import { showtimesUrl } from "../engine/index.js";
import { channelFor } from "../notify/index.js";
import {
  ago, byUrgency, minutesSince, summarise, watchState, type WatchView,
} from "../lib/view.js";
import { AppHeader } from "../components/AppHeader.js";
import { CopyField } from "../components/CopyField.js";
import { HealthBanner } from "../components/HealthBanner.js";
import { StickyAction } from "../components/StickyAction.js";
import { WatchCard } from "../components/WatchCard.js";
import { listedButNotMine } from "../lib/narrowing.js";

export const dynamic = "force-dynamic";

const APP_ORIGIN = "https://drop-watcher.vercel.app";

export default async function Home({
  searchParams,
}: { searchParams: { test?: string } }) {
  /**
   * Send yourself a test alert.
   *
   * Subscribing to a topic is the one setup step that silently costs someone
   * every alert they were promised — ntfy never tells us whether anyone is
   * listening, so without this a new member has no way to know it worked short
   * of waiting for a film to go on sale.
   *
   * Sent through the worker's own adapter, so a pass proves the real path
   * rather than only that ntfy is reachable.
   */
  async function sendTest() {
    "use server";
    const me = await currentUser();
    if (!me) return;
    const mine = await db.select().from(channels)
      .where(and(eq(channels.userId, me.id), eq(channels.active, true)));
    if (mine.length === 0) redirect("/?test=nochannel");

    let ok = false;
    for (const row of mine) {
      const result = await channelFor({ id: row.id, kind: row.kind, config: row.config })
        .send({
          title: "Drop Watcher: test alert",
          body: "Your notifications are working. Real alerts look like this, "
            + "with Book now and Got it buttons.",
          clickUrl: APP_ORIGIN,
          actions: [{ label: "Open Drop Watcher", url: APP_ORIGIN }],
          priority: "high",
        });
      if (result.ok) ok = true;
    }
    redirect(ok ? "/?test=sent" : "/?test=failed");
  }

  const user = await currentUser();

  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-[640px] px-4 pb-16 pt-10">
          <h1 className="text-[36px] font-extrabold leading-[.98] tracking-tight2">
            Know the minute tickets drop.
          </h1>
          <p className="mt-4 text-[17px] leading-[1.5] text-neutral-800">
            Drop Watcher checks BookMyShow every few minutes and buzzes your phone the moment a
            date goes on sale — including a premiere that isn&apos;t listed yet.
          </p>
          <p className="mt-6 border-t-2 border-divider pt-4 text-[15px] text-neutral-700">
            You need an invite link to use this.
          </p>
        </main>
      </>
    );
  }

  const rows = await db
    .select({ sub: subscriptions, target: targets })
    .from(subscriptions)
    .innerJoin(targets, eq(subscriptions.targetId, targets.id))
    .where(eq(subscriptions.userId, user.id))
    .orderBy(desc(subscriptions.createdAt));

  // Who else is on the same film and date. One query for the whole page
  // rather than one per card.
  const companions = rows.length
    ? await db
        .select({
          targetId: subscriptions.targetId,
          showDate: subscriptions.showDate,
          id: users.id,
          name: users.displayName,
        })
        .from(subscriptions)
        .innerJoin(users, eq(subscriptions.userId, users.id))
        .where(and(
          inArray(subscriptions.targetId, rows.map((r) => r.target.id)),
          ne(subscriptions.userId, user.id),
        ))
    : [];

  // How many cinemas each watched date actually had, last clean read.
  const counts = rows.length
    ? await db
        .select({
          targetId: targetDates.targetId,
          showDate: targetDates.showDate,
          venueCount: targetDates.venueCount,
          venues: targetDates.venues,
        })
        .from(targetDates)
        .where(inArray(targetDates.targetId, rows.map((r) => r.target.id)))
    : [];
  const listedCounts = new Map(counts.map((c) => [`${c.targetId}:${c.showDate}`, c.venueCount]));
  const listedVenues = new Map(counts.map((c) => [`${c.targetId}:${c.showDate}`, c.venues]));

  const now = new Date();
  const watches: WatchView[] = rows.map(({ sub, target }) => ({
    id: sub.id,
    title: target.title,
    city: target.city,
    showDate: sub.showDate,
    state: watchState(sub, target, now),
    // From what was actually listed for THIS date, not the city catalogue.
    // Previously always undefined, so every on-sale card read "0 cinemas".
    venuesListed: listedCounts.get(`${target.id}:${sub.showDate}`),
    notMine: listedButNotMine(
      sub.cinemaPicks, sub.screenFilters,
      (listedVenues.get(`${target.id}:${sub.showDate}`) ?? []).map((v) => ({
        code: v.code, name: v.name, screens: v.screens,
      })),
    ),
    lastCleanReadAt: target.lastOkAt,
    minutesSinceCleanRead: minutesSince(target.lastOkAt, now),
    bookUrl: showtimesUrl(target.movieUrl, sub.showDate, {
      bookCode: target.bookCode, language: target.language,
    }),
    alsoWatching: companions
      .filter((c) => c.targetId === target.id && c.showDate === sub.showDate)
      .map((c) => ({ id: c.id, name: c.name ?? "A friend" })),
  })).sort(byUrgency);

  const [channel] = await db.select().from(channels).where(eq(channels.userId, user.id)).limit(1);
  const topic = (channel?.config as { topic?: string } | undefined)?.topic ?? "";

  const blind = watches.filter((w) => w.state === "cant_read");
  const blindMinutes = blind.length
    ? Math.max(...blind.map((w) => w.minutesSinceCleanRead ?? 0))
    : null;
  const lastClean = watches.reduce<Date | null>(
    (best, w) => (w.lastCleanReadAt && (!best || w.lastCleanReadAt > best) ? w.lastCleanReadAt : best),
    null,
  );
  const name = (user.displayName ?? user.email).split(/[@\s]/)[0] ?? "there";

  return (
    <>
      <AppHeader devices admin={user.isOwner} initial={name.charAt(0)} />

      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-4">
        {searchParams.test ? (
          <p
            role="status"
            className={`mb-3 border-2 px-3 py-2 text-[15px] font-semibold ${
              searchParams.test === "sent" ? "border-ink" : "border-accent-700 text-accent-700"
            }`}
          >
            {searchParams.test === "sent"
              ? "Test alert sent. If it doesn't arrive, you're not subscribed to your topic yet."
              : searchParams.test === "nochannel"
                ? "You have no notification channel set up — nothing to send to."
                : "ntfy refused the test. Try again, or check the topic below."}
          </p>
        ) : null}
        {watches.length > 0 ? (
          <HealthBanner blind={blind.length > 0} minutes={blindMinutes} lastCleanRead={ago(lastClean, now)} />
        ) : null}

        {watches.length === 0 ? (
          <section className="pt-4">
            <span className="text-[11px] font-extrabold uppercase tracking-kicker text-accent-700">
              You&apos;re in, {name}
            </span>
            <h1 className="mt-2 text-[36px] font-extrabold leading-[.96] tracking-tight2">
              Two minutes of setup, then we watch so you don&apos;t have to.
            </h1>

            <ol className="mt-8 border-t-2 border-ink md:grid md:grid-cols-3 md:gap-0">
              <li className="border-b-2 border-divider py-5 md:border-b-0 md:border-r-2 md:pr-5">
                <span className="block text-[40px] font-extrabold leading-none text-accent">1</span>
                <h2 className="mt-2 text-xl font-extrabold tracking-tight1">Turn on alerts</h2>
                <p className="mt-2 text-[15px] text-neutral-800">
                  Install the free <strong>ntfy</strong> app and subscribe to this topic. Without
                  it we have nowhere to reach you.
                </p>
                <div className="mt-3"><CopyField value={topic} big /></div>
                {/* The TOPIC's url, not ntfy's app root. The root opens an
                    empty inbox with nothing selected, so there is no subscribe
                    button for a topic it has never heard of. This one opens
                    the topic itself, and deep-links into the phone app when it
                    is installed. */}
                <a
                  href={`https://ntfy.sh/${topic}`}
                  className="mt-2 flex min-h-[44px] items-center justify-between border-2 border-divider px-3.5 text-[15px] font-extrabold text-ink no-underline"
                >
                  <span>Open this topic in ntfy</span>
                  <ArrowUpRight size={18} strokeWidth={2.5} />
                </a>
                <p className="mt-2 text-[13px] text-neutral-700">
                  In the app, tap <strong>+</strong> and paste the topic if the link doesn&apos;t
                  open it for you. ntfy&apos;s free tier limits how many topics you can follow,
                  so remove unused ones first if it refuses.
                </p>
                <form action={sendTest}>
                  <button
                    type="submit"
                    className="mt-2 flex min-h-[44px] w-full items-center justify-between border-2 border-ink px-3.5 text-[15px] font-extrabold"
                  >
                    <span>Send me a test alert</span>
                    <Bell size={18} strokeWidth={2.5} />
                  </button>
                </form>
              </li>
              <li className="border-b-2 border-divider py-5 md:border-b-0 md:border-r-2 md:px-5">
                <span className="block text-[40px] font-extrabold leading-none text-accent">2</span>
                <h2 className="mt-2 text-xl font-extrabold tracking-tight1">Paste a showtimes link</h2>
                <p className="mt-2 text-[15px] text-neutral-800">
                  Open the film on BookMyShow, tap <strong>Book tickets</strong>, pick any date,
                  then copy the address.
                </p>
              </li>
              <li className="py-5 md:pl-5">
                <span className="block text-[40px] font-extrabold leading-none text-accent">3</span>
                <h2 className="mt-2 text-xl font-extrabold tracking-tight1">Pick the dates you want</h2>
                <p className="mt-2 text-[15px] text-neutral-800">
                  Including one with nothing on sale yet. That&apos;s where a premiere appears.
                </p>
              </li>
            </ol>
          </section>
        ) : (
          <>
            <div className="mt-6 border-b-2 border-divider pb-3">
              <h1 className="text-[28px] font-extrabold leading-none tracking-tight2">Your watches</h1>
              <p className="mt-1.5 text-[15px] text-neutral-700">{summarise(watches.map((w) => w.state))}</p>
            </div>

            <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr))]">
              {watches.map((w) => <WatchCard key={w.id} watch={w} />)}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 border-y-2 border-divider py-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-700">
                <Bell size={16} strokeWidth={2.5} className="shrink-0" />
                <span className="truncate">Your alerts go to ntfy topic</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <CopyField value={topic} />
                <a
                  href={`https://ntfy.sh/${topic}`}
                  aria-label="Open this topic in ntfy"
                  className="flex h-11 w-11 items-center justify-center border-2 border-divider text-ink no-underline"
                >
                  <ArrowUpRight size={18} strokeWidth={2.5} />
                </a>
                <form action={sendTest}>
                  <button
                    type="submit"
                    aria-label="Send me a test alert"
                    title="Send me a test alert"
                    className="flex h-11 w-11 items-center justify-center border-2 border-divider text-ink"
                  >
                    <Bell size={18} strokeWidth={2.5} />
                  </button>
                </form>
              </span>
            </div>
          </>
        )}
      </main>

      <StickyAction>
        <Link
          href="/new"
          className="flex min-h-[54px] items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white no-underline transition-transform duration-75 active:scale-[.98]"
        >
          <span>Add a watch</span>
          <Plus size={20} strokeWidth={2.5} />
        </Link>
      </StickyAction>
    </>
  );
}
