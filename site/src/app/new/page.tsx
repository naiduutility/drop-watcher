import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "../../db/index.js";
import { subscriptions, targets, users, venues } from "../../db/schema.js";
import { currentUser } from "../../lib/auth.js";
import { parseBmsUrl } from "../../lib/bms-url.js";
import type { Member } from "../../lib/view.js";
import { AppHeader } from "../../components/AppHeader.js";
import { AddStep1 } from "../../components/AddStep1.js";
import { AddStep2 } from "../../components/AddStep2.js";

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
