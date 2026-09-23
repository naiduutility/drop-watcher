import { notFound, redirect } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { Bell, BellOff } from "lucide-react";

import { db } from "../../../db/index.js";
import { checks, subscriptions, targetDates, targets, users, venues } from "../../../db/schema.js";
import { currentUser } from "../../../lib/auth.js";
import { Outcome, showtimesUrl } from "../../../engine/index.js";
import { ago, dateParts, minutesSince, nameList, watchState, type Member } from "../../../lib/view.js";
import { AppHeader } from "../../../components/AppHeader.js";
import { CinemaPicker } from "../../../components/CinemaPicker.js";
import { DeleteWatch } from "../../../components/DeleteWatch.js";
import { WatchHero, type CheckCell } from "../../../components/WatchHero.js";
import { NotYourScreen } from "../../../components/NotYourScreen.js";
import { narrowingReport, wrongScreens } from "../../../lib/narrowing.js";

export const dynamic = "force-dynamic";

/** Parse the picker's JSON, defensively: a server action is a public endpoint
 *  and this arrives from a form field. */
function readPicks(raw: unknown): { code: string; screens: string[] }[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.code === "string")
      .slice(0, 60)
      .map((p) => ({
        code: String(p.code),
        screens: Array.isArray(p.screens) ? p.screens.map(String).slice(0, 20) : [],
      }));
  } catch {
    return [];
  }
}


const OUTCOME_LABEL: Record<string, string> = {
  [Outcome.OK_SHOWS]: "Clean read · shows listed",
  [Outcome.OK_EMPTY]: "Clean read · nothing listed",
  [Outcome.DATE_FALLBACK]: "Clean read · nothing listed",
  [Outcome.BLOCKED]: "Blocked by BookMyShow",
  [Outcome.PAGE_ERROR]: "BookMyShow error page",
  [Outcome.UNPARSEABLE]: "Error on our side",
  [Outcome.BAD_CODE]: "Booking code looks wrong",
};

const CLEAN = [Outcome.OK_SHOWS, Outcome.OK_EMPTY, Outcome.DATE_FALLBACK] as string[];

export default async function WatchDetail({ params }: { params: { id: string } }) {
  const me = await currentUser();
  if (!me) redirect("/");

  const [row] = await db
    .select({ sub: subscriptions, target: targets })
    .from(subscriptions)
    .innerJoin(targets, eq(subscriptions.targetId, targets.id))
    .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, me.id)))
    .limit(1);
  // Not-found and not-yours answer identically: which ids exist is nobody
  // else's business.
  if (!row) notFound();

  const { sub, target } = row;
  const now = new Date();
  const state = watchState(sub, target, now);
  const when = dateParts(sub.showDate);
  const bookUrl = showtimesUrl(target.movieUrl, sub.showDate, {
    bookCode: target.bookCode, language: target.language,
  });

  const [friendRows, recent, forDate, cityVenues] = await Promise.all([
    db.select({ id: users.id, name: users.displayName })
      .from(subscriptions).innerJoin(users, eq(subscriptions.userId, users.id))
      .where(and(eq(subscriptions.targetId, target.id),
                 eq(subscriptions.showDate, sub.showDate),
                 ne(subscriptions.userId, me.id))),
    db.select().from(checks)
      .where(and(eq(checks.targetId, target.id), eq(checks.requestedDate, sub.showDate)))
      .orderBy(desc(checks.at)).limit(12),
    db.select().from(targetDates)
      .where(and(eq(targetDates.targetId, target.id), eq(targetDates.showDate, sub.showDate)))
      .limit(1),
    db.select({ code: venues.code, name: venues.name, screens: venues.screens })
      .from(venues).where(eq(venues.city, target.city)).limit(60),
  ]);

  const friends: Member[] = friendRows.map((f) => ({ id: f.id, name: f.name ?? "A friend" }));
  const listed = forDate[0];

  async function silence() {
    "use server";
    const who = await currentUser();
    if (!who) return;
    await db.update(subscriptions).set({ state: "acked", ackedAt: new Date() })
      .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, who.id)));
    redirect(`/w/${params.id}`);
  }

  async function watchAgain() {
    "use server";
    const who = await currentUser();
    if (!who) return;
    await db.update(subscriptions)
      .set({ state: "armed", ackedAt: null, firedAt: null, remindersSent: 0 })
      .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, who.id)));
    redirect(`/w/${params.id}`);
  }

  async function remove() {
    "use server";
    const who = await currentUser();
    if (!who) return;
    // Scoped to the caller's own row: deleting yours can never touch a
    // friend's watch of the same film and date.
    await db.delete(subscriptions)
      .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, who.id)));
    redirect("/");
  }

  async function widen(code: string) {
    "use server";
    const who = await currentUser();
    if (!who) return;
    const [mine] = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, who.id))).limit(1);
    if (!mine) return;
    // Drop the screen narrowing for that one cinema, keeping the cinema. The
    // way out of a miss should cost one tap, not a re-edit of the whole watch.
    await db.update(subscriptions)
      .set({ cinemaPicks: mine.cinemaPicks.map((p) => p.code === code ? { ...p, screens: [] } : p) })
      .where(eq(subscriptions.id, params.id));
    redirect(`/w/${params.id}`);
  }

  async function refine(form: FormData) {
    "use server";
    const who = await currentUser();
    if (!who) return;
    await db.update(subscriptions).set({
      cinemaPicks: readPicks(form.get("cinemaPicks")),
      screenFilters: form.getAll("screenFilters").map(String).filter(Boolean),
    }).where(and(eq(subscriptions.id, params.id), eq(subscriptions.userId, who.id)));
    redirect(`/w/${params.id}`);
  }

  // Why a narrowed watch is quiet: listed here, but not in the room asked for.
  const misses = wrongScreens(narrowingReport(sub.cinemaPicks, listed?.venues ?? []));

  const cells: CheckCell[] = [...recent].reverse().map((c) => ({
    ok: CLEAN.includes(c.outcome),
    label: `${c.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · ${
      OUTCOME_LABEL[c.outcome] ?? c.outcome
    }`,
  }));

  return (
    <>
      <AppHeader back={{ href: "/", label: "Your watches" }} initial={(me.displayName ?? me.email).charAt(0)} />

      <WatchHero
        state={state}
        title={target.title}
        city={target.city}
        showDate={sub.showDate}
        venueCount={listed?.venueCount ?? 0}
        seenAt={listed ? listed.seenAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null}
        minutesBlind={minutesSince(target.lastOkAt, now)}
        lastCleanRead={ago(target.lastOkAt, now)}
        friends={friends}
        checks={cells}
        bookUrl={bookUrl}
      />

      <main className="mx-auto max-w-[880px] px-4 pb-16 pt-5">
        {state !== "silenced" ? (
          <NotYourScreen misses={misses} bookUrl={bookUrl} widen={widen} />
        ) : null}

        {state === "on_sale" && listed && listed.venues.length > 0 ? (
          <section className="mb-7">
            <h2 className="border-b-2 border-ink pb-2 text-xl font-extrabold tracking-tight1">
              Listed for {when.short}
            </h2>
            <ul>
              {listed.venues.slice(0, 8).map((v) => (
                <li key={v.code} className="border-b border-divider py-2.5">
                  <span className="block text-[15px] font-semibold">{v.name}</span>
                  {v.screens && v.screens.length > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {v.screens.slice(0, 3).map((s) => (
                        <span key={s} className="border border-divider px-1.5 py-0.5 text-[11px] text-neutral-700">
                          {s}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {listed.venues.length > 8 ? (
              <p className="mt-2 text-[13px] text-neutral-700">
                and {listed.venues.length - 8} more on BookMyShow
              </p>
            ) : null}
          </section>
        ) : null}

        {friends.length > 0 ? (
          <section className="mb-7 flex items-center gap-3">
            <span className="flex shrink-0">
              {friends.slice(0, 3).map((f, i) => (
                <span
                  key={f.id}
                  className="flex h-10 w-10 items-center justify-center bg-ink text-base font-extrabold text-bg"
                  style={{ marginLeft: i === 0 ? 0 : -8 }}
                >
                  {f.name.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
            <p className="text-[15px] leading-[1.4]">
              <strong>{nameList(friends)}</strong>{" "}
              {friends.length === 1 ? "is" : "are"} waiting on this date too. Same check, separate
              alerts.
            </p>
          </section>
        ) : null}

        <form action={refine} className="mb-7">
          <CinemaPicker
            city={target.city}
            cinemas={cityVenues.map((c) => ({ code: c.code, name: c.name, screens: c.screens }))}
            initialPicks={sub.cinemaPicks}
            initialScreens={sub.screenFilters}
          />
          <button
            type="submit"
            className="mt-3 flex min-h-[48px] w-full items-center justify-center border-2 border-divider px-4 text-[15px] font-extrabold"
          >
            Save cinemas
          </button>
        </form>

        {recent.length > 0 ? (
          <section className="mb-7">
            <h2 className="text-xl font-extrabold tracking-tight1">
              Recent checks
              <span className="ml-2 text-[13px] font-semibold text-neutral-700">every ~5 min</span>
            </h2>
            <table className="mt-2 w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b-2 border-ink text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
                  <th className="w-14 py-1.5 text-left">Time</th>
                  <th className="py-1.5 text-left">What we saw</th>
                  <th className="w-16 py-1.5 text-right">Cinemas</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 8).map((c) => {
                  const clean = CLEAN.includes(c.outcome);
                  return (
                    <tr key={c.id} className={`border-b border-divider ${clean ? "" : "text-accent-700"}`}>
                      <td className="py-2 tabular-nums">
                        {c.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className={`py-2 ${c.outcome === Outcome.OK_SHOWS ? "font-extrabold" : ""}`}>
                        {OUTCOME_LABEL[c.outcome] ?? c.outcome}
                      </td>
                      <td className="py-2 text-right tabular-nums">{c.venueCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {sub.ackedKeys.length > 0 ? (
          <section className="mb-7 border-2 border-neutral-300 p-4">
            <h2 className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
              Silenced screens
            </h2>
            <p className="mt-1 text-[14px] text-neutral-700">
              These stay quiet. The rest of this watch is still running.
            </p>
            <ul className="mt-2">
              {sub.ackedKeys.map((k) => {
                const screen = k.split("|")[1];
                return (
                  <li key={k} className="flex items-center justify-between gap-3 border-t border-divider py-2.5">
                    <span className="text-[15px] font-semibold">
                      {screen && screen !== "*" ? screen : k.split("|")[0]?.toUpperCase()}
                    </span>
                    <form action={`/s/${params.id}/unack?k=${encodeURIComponent(k)}`} method="post">
                      <button type="submit" className="min-h-[44px] text-[15px] font-extrabold text-accent-700">
                        Watch it again
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {state === "silenced" ? (
          <form action={watchAgain}>
            <button
              type="submit"
              className="flex min-h-[56px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white"
            >
              <span>Watch again</span>
              <Bell size={20} strokeWidth={2.5} />
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3 border-y-2 border-divider py-3">
            <span className="text-[15px]">
              <strong>Alerts are on</strong>
              <span className="block text-[13px] text-neutral-700">
                Only you are affected. Undo any time.
              </span>
            </span>
            <form action={silence}>
              <button
                type="submit"
                className="flex min-h-[48px] items-center gap-2 border-2 border-divider px-3.5 text-[15px] font-extrabold"
              >
                <BellOff size={18} strokeWidth={2.5} />
                Silence
              </button>
            </form>
          </div>
        )}

        <DeleteWatch action={remove} dateLabel={when.short} friendNames={nameList(friends)} />
      </main>
    </>
  );
}
