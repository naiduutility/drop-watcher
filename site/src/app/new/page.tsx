import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { subscriptions, targets, venues } from "../../db/schema.js";
import { currentUser } from "../../lib/auth.js";
import {
  NEEDS_SHOWTIMES_HELP, fromDateInput, parseBmsUrl, toDateInput,
} from "../../lib/bms-url.js";

export const dynamic = "force-dynamic";

function pretty(yyyymmdd: string) {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)),
  );
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

/** The next fortnight, so a date with no shows yet is still choosable — which
 *  is the entire premiere case and the reason this product exists. */
function upcomingDates(): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

export default async function New({
  searchParams,
}: { searchParams: { url?: string; error?: string } }) {
  const user = await currentUser();
  if (!user) return <><h1>Add a watch</h1><p>You need an invite link first.</p></>;

  const pasted = searchParams.url?.trim();
  const parsed = pasted ? parseBmsUrl(pasted) : null;

  async function create(form: FormData) {
    "use server";
    const me = await currentUser();
    if (!me) return;
    const raw = String(form.get("url") ?? "");
    const p = parseBmsUrl(raw);
    if (p.kind !== "showtimes") return;

    const dates = form.getAll("dates").map(String).map(fromDateInput).filter(Boolean) as string[];
    if (dates.length === 0) {
      redirect(`/new?url=${encodeURIComponent(raw)}&error=nodates`);
    }

    // One target per (city, bookCode, language): a second person watching the
    // same premiere joins the existing target rather than doubling the scrapes.
    const [target] = await db
      .insert(targets)
      .values({
        city: p.city, slug: p.slug, title: String(form.get("title") ?? p.slug),
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
        .values({ userId: me.id, targetId: target.id, showDate })
        .onConflictDoNothing();
    }
    redirect("/");
  }

  if (!parsed || parsed.kind === "unrecognised") {
    return (
      <>
        <h1>Add a watch</h1>
        {parsed?.kind === "unrecognised" ? (
          <p className="warn">{parsed.reason}</p>
        ) : null}
        <form method="get">
          <p><input type="url" name="url" placeholder="Paste a BookMyShow showtimes link" required /></p>
          <button type="submit">Continue</button>
        </form>
        <div className="card">
          <strong>Which link?</strong>
          <p className="muted" style={{ margin: ".35rem 0 0" }}>
            Open the film on BookMyShow, tap <em>Book tickets</em>, pick any date,
            then copy the URL from the address bar. That page&apos;s address carries
            the booking code — the movie page&apos;s does not, and a guessed code
            produces a watch that stays silent forever.
          </p>
        </div>
        <p><a href="/">Back to your watches</a></p>
      </>
    );
  }

  if (parsed.kind === "movie") {
    return (
      <>
        <h1>Nearly — one more step</h1>
        <p className="warn">{NEEDS_SHOWTIMES_HELP}</p>
        <p className="muted">
          You pasted the page for <strong>{parsed.slug}</strong> in {parsed.city}.
        </p>
        <form method="get">
          <p><input type="url" name="url" placeholder="Paste the showtimes link" required /></p>
          <button type="submit">Continue</button>
        </form>
      </>
    );
  }

  // Known cinemas in this city, purely to reassure: refinement to a specific
  // theatre happens after the first read, when we know what is actually running.
  const known = await db
    .select({ name: venues.name, code: venues.code })
    .from(venues).where(eq(venues.city, parsed.city)).limit(60);

  const existing = await db
    .select({ id: targets.id, offeredDates: targets.offeredDates })
    .from(targets)
    .where(and(eq(targets.city, parsed.city), eq(targets.bookCode, parsed.bookCode)))
    .limit(1);
  const onSale = new Set(existing[0]?.offeredDates ?? []);

  return (
    <>
      <h1>Which dates?</h1>
      <p className="muted">
        {parsed.city} · booking code <code>{parsed.bookCode}</code>
        {parsed.language ? ` · ${parsed.language}` : ""}
      </p>

      <form action={create}>
        <input type="hidden" name="url" value={pasted} />
        <p>
          <input type="text" name="title" defaultValue={parsed.slug.replace(/-/g, " ")}
                 placeholder="What to call it in alerts" />
        </p>
        <div>
          {upcomingDates().map((d) => (
            <label className="date" key={d}>
              <input type="checkbox" name="dates" value={toDateInput(d)}
                     defaultChecked={d === parsed.date} />
              <span>
                {pretty(d)}
                {onSale.has(d)
                  ? <span className="muted"> · on sale</span>
                  : <span className="muted"> · not yet</span>}
              </span>
            </label>
          ))}
        </div>
        {searchParams.error === "nodates" ? (
          <p className="warn">Pick at least one date.</p>
        ) : null}
        <p className="muted" style={{ fontSize: ".85rem" }}>
          Dates marked <em>not yet</em> are the useful ones: a premiere that has
          no shows listed is exactly what this watches for.
        </p>
        <button type="submit">Start watching</button>
      </form>

      <h2>Theatres</h2>
      <p className="muted">
        Watching <strong>any theatre</strong> in {parsed.city} to begin with. Once
        the first check runs you can narrow it to particular cinemas or screens —
        a venue list only exists for a date that is already on sale.
        {known.length > 0
          ? ` We currently know ${known.length} cinema(s) here from previous checks.`
          : " We have not catalogued this city yet; the first check will start it."}
      </p>
      <p><a href="/">Back to your watches</a></p>
    </>
  );
}
