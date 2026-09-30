import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "../../db/index.js";
import { subscriptions, targets, users, venues } from "../../db/schema.js";
import { currentUser } from "../../lib/auth.js";
import { parseBmsUrl } from "../../lib/bms-url.js";
import type { Priority } from "../../core/schedule.js";
import type { Member } from "../../lib/view.js";
import { AppHeader } from "../../components/AppHeader.js";
import { AddStep1 } from "../../components/AddStep1.js";
import { AddStep2 } from "../../components/AddStep2.js";

export const dynamic = "force-dynamic";

/**
 * The cadence ladder, in the words a person picking one actually has.
 *
 * Nobody knows what "normal" means, but everybody knows whether their film is
 * out this week or next year — so the note is the real label and the interval
 * is the detail. The order is the only thing the server trusts about this
 * list; the value is validated against it before it reaches the scheduler.
 */
const CADENCES: { v: Priority; label: string; note: string }[] = [
  { v: "hot", label: "Every 5 min", note: "a drop any day now" },
  { v: "brisk", label: "Every 15 min", note: "out this week" },
  { v: "normal", label: "Every 30 min", note: "a few weeks away" },
  { v: "cold", label: "Hourly", note: "a month or two" },
  { v: "slow", label: "Every 6 hours", note: "later this year" },
  { v: "glacial", label: "Once a day", note: "months away" },
];

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


/** The next fortnight. A date with no shows yet is still offered — that is the
 *  premiere, and the whole reason for this screen. */
function fortnight(): string[] {
  const base = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  });
}

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-1">
        <span className="h-1 w-6 bg-accent-600" />
        <span className={`h-1 w-6 ${step === 2 ? "bg-accent-600" : "bg-neutral-300"}`} />
      </span>
      <span className="text-[13px] font-semibold text-neutral-700">Step {step} of 2</span>
    </span>
  );
}

export default async function New({
  searchParams,
}: { searchParams: { url?: string } }) {
  const user = await currentUser();
  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-[640px] px-4 pt-10">
          <h1 className="text-[28px] font-extrabold tracking-tight2">Add a watch</h1>
          <p className="mt-3 text-[15px] text-neutral-800">You need an invite link first.</p>
        </main>
      </>
    );
  }

  const pasted = searchParams.url?.trim() ?? "";
  const parsed = pasted ? parseBmsUrl(pasted) : null;

  /**
   * A film with no Book tickets button yet.
   *
   * There is no showtimes page, so no booking code and no dates to choose —
   * the watch is simply "tell me when this goes on sale". The worker reads the
   * film's own page until the CTA appears, proves a code, and promotes it.
   */
  async function watchUnreleased(form: FormData) {
    "use server";
    // Chosen by the person, not inferred. A form field is public input, so an
    // unrecognised value falls back rather than reaching the scheduler.
    function pickPriority(raw: FormDataEntryValue | null): Priority {
      const v = String(raw ?? "");
      return (CADENCES.some((c) => c.v === v) ? v : "hot") as Priority;
    }
    const me = await currentUser();
    if (!me) return;
    const p = parseBmsUrl(String(form.get("url") ?? ""));
    if (p.kind !== "movie") return;

    const [t] = await db.insert(targets).values({
      city: p.city, slug: p.slug,
      title: String(form.get("title") ?? "").trim() || p.slug.replace(/-/g, " "),
      movieUrl: p.movieUrl, pageCode: p.pageCode, bookCode: "",
      language: null, status: "unresolved",
      priority: pickPriority(form.get("priority")), createdBy: me.id,
    }).onConflictDoUpdate({
      target: [targets.city, targets.bookCode, targets.language],
      set: { status: "unresolved" },
    }).returning();
    if (!t) return;

    // "*" is the date sentinel for "whenever booking opens" — there are no
    // real dates to pick until BookMyShow creates them.
    await db.insert(subscriptions)
      .values({ userId: me.id, targetId: t.id, showDate: "*" })
      .onConflictDoNothing();
    redirect("/");
  }

  async function create(form: FormData) {
    "use server";
    const me = await currentUser();
    if (!me) return;
    const raw = String(form.get("url") ?? "");
    // Classified again here: the client check is for the person, this one is
    // the guard. A server action is a public endpoint.
    const p = parseBmsUrl(raw);
    if (p.kind !== "showtimes") return;

    const dates = form.getAll("dates").map(String).filter((d) => /^\d{8}$/.test(d));
    if (dates.length === 0) return;
    const cinemaPicks = readPicks(form.get("cinemaPicks"));
    const screenFilters = form.getAll("screenFilters").map(String).filter(Boolean);
    const title = String(form.get("title") ?? "").trim() || p.slug.replace(/-/g, " ");

    // One target per (city, bookCode, language). A second person watching the
    // same premiere joins it rather than doubling the requests to BookMyShow.
    const [target] = await db
      .insert(targets)
      .values({
        city: p.city, slug: p.slug, title,
        movieUrl: p.movieUrl, pageCode: p.pageCode ?? "", bookCode: p.bookCode,
        language: p.language, priority: "hot", createdBy: me.id,
      })
      .onConflictDoUpdate({
        target: [targets.city, targets.bookCode, targets.language],
        set: { status: "active" },
      })
      .returning();
    if (!target) return;

    for (const showDate of dates) {
      await db.insert(subscriptions)
        .values({ userId: me.id, targetId: target.id, showDate, cinemaPicks, screenFilters })
        .onConflictDoNothing();
    }
    redirect("/");
  }

  if (parsed?.kind === "movie") {
    return (
      <>
        <AppHeader back={{ href: "/new", label: "Back" }} right={<Progress step={1} />} />
        <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-5">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Not on sale yet
          </span>
          <h1 className="mt-1 text-[32px] font-extrabold leading-[.98] tracking-tight2">
            {parsed.slug.replace(/-/g, " ")}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.5] text-neutral-800">
            This film has no <strong>Book tickets</strong> button yet, so there are no dates to
            choose and no showtimes link to paste. We can watch the film&apos;s own page instead
            and tell you the moment booking opens in {parsed.city}.
          </p>
          <p className="mt-3 text-[15px] leading-[1.5] text-neutral-800">
            The moment it goes on sale we move this watch onto the <strong>first day
            listed</strong> — the premiere, when there is one — and tell you. Nothing for you to
            do at six in the morning. Other dates you can add yourself afterwards.
          </p>
          <form action={watchUnreleased} className="mt-6">
            <input type="hidden" name="url" value={pasted} />

            <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
              How often should we look?
            </span>
            {/* gap-px over a dark background draws the grid lines, so the same
                markup works at two columns on a phone and three on a wide
                screen. Doing it with per-cell borders needs to know which
                cells start a row, which changes with the breakpoint. */}
            <div className="mt-2 grid grid-cols-2 gap-px border-2 border-ink bg-ink sm:grid-cols-3">
              {CADENCES.map((o) => (
                <label
                  key={o.v}
                  title={o.note}
                  className="flex min-h-[60px] cursor-pointer flex-col items-center justify-center bg-bg px-2 py-2 text-center has-[:checked]:bg-ink has-[:checked]:text-bg sm:min-h-[52px]"
                >
                  <input type="radio" name="priority" value={o.v}
                         defaultChecked={o.v === "hot"} className="sr-only" />
                  <span className="text-[15px] font-extrabold leading-tight sm:text-[14px]">
                    {o.label}
                  </span>
                  <span className="mt-0.5 text-[11px] leading-tight opacity-70">{o.note}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[13px] leading-[1.45] text-neutral-700">
              Five minutes is as fast as the watcher runs. Slower settings exist because every
              request is one the on-sale watches need too — BookMyShow refuses roughly half of
              them as it is.
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-neutral-700">
              Whatever you pick, we speed up on our own as the film gets close: <strong>hourly
              from a week out</strong>, and <strong>every 5 minutes for the last day</strong>. So
              a slow setting costs you nothing at the moment it matters.
            </p>

            <label className="mt-5 block">
              <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
                Name in your alerts
              </span>
              <input
                name="title"
                defaultValue={parsed.slug.replace(/-/g, " ")}
                className="mt-2 w-full border-2 border-divider bg-transparent px-3 py-3 text-[15px] outline-none"
              />
            </label>
            <button
              type="submit"
              title="Watch the film's page. The moment booking opens we take the first day and alert you."
              className="mt-4 flex min-h-[54px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white"
            >
              <span>Tell me when booking opens</span>
            </button>
          </form>

        </main>
      </>
    );
  }

  if (!parsed || parsed.kind !== "showtimes") {
    return (
      <>
        <AppHeader back={{ href: "/", label: "Back" }} right={<Progress step={1} />} />
        <AddStep1 initial={pasted} />
      </>
    );
  }

  // Everything step 2 needs, in parallel: the city's known cinemas, whether
  // this film already exists (for its date strip), and who else watches it.
  const [known, existing] = await Promise.all([
    db.select({ code: venues.code, name: venues.name, screens: venues.screens })
      .from(venues).where(eq(venues.city, parsed.city)).limit(60),
    db.select({ id: targets.id, offeredDates: targets.offeredDates })
      .from(targets)
      .where(and(eq(targets.city, parsed.city), eq(targets.bookCode, parsed.bookCode)))
      .limit(1),
  ]);

  const targetId = existing[0]?.id;
  const mine: Record<string, string> = {};
  let friends: Member[] = [];

  if (targetId) {
    const [ours, theirs] = await Promise.all([
      db.select({ id: subscriptions.id, showDate: subscriptions.showDate })
        .from(subscriptions)
        .where(and(eq(subscriptions.targetId, targetId), eq(subscriptions.userId, user.id))),
      db.select({ id: users.id, name: users.displayName })
        .from(subscriptions)
        .innerJoin(users, eq(subscriptions.userId, users.id))
        .where(and(eq(subscriptions.targetId, targetId), ne(subscriptions.userId, user.id))),
    ]);
    for (const row of ours) mine[row.showDate] = row.id;
    const seen = new Set<string>();
    friends = theirs
      .filter((f) => !seen.has(f.id) && seen.add(f.id))
      .map((f) => ({ id: f.id, name: f.name ?? "A friend" }));
  }

  return (
    <>
      <AppHeader back={{ href: "/new", label: "Back" }} right={<Progress step={2} />} />
      <AddStep2
        action={create}
        url={pasted}
        film={parsed.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
        city={parsed.city.replace(/\b\w/g, (c) => c.toUpperCase())}
        language={parsed.language}
        dates={fortnight()}
        onSale={existing[0]?.offeredDates ?? []}
        alreadyMine={mine}
        cinemas={known.map((c) => ({ code: c.code, name: c.name, screens: c.screens }))}
        friends={friends}
        defaultDate={parsed.date}
      />
    </>
  );
}
