import { desc, eq } from "drizzle-orm";

import { currentUser } from "../lib/auth.js";
import { db } from "../db/index.js";
import { channels, subscriptions, targets } from "../db/schema.js";
import { Outcome } from "../engine/index.js";

export const dynamic = "force-dynamic";

function pretty(yyyymmdd: string) {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)),
  );
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

function ago(then: Date | null) {
  if (!then) return "never";
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * How a watch is doing, in words rather than a green dot.
 *
 * The point of this line is that "nothing has happened" and "we cannot read
 * BookMyShow" are different sentences. On 2026-09-22 they looked identical for
 * forty minutes and nobody could tell which one they were living in.
 */
function health(lastOutcome: string | null, lastOkAt: Date | null) {
  if (!lastOutcome) return { cls: "muted", text: "not checked yet" };
  switch (lastOutcome) {
    case Outcome.OK_SHOWS:
      return { cls: "ok", text: `reading fine, shows listed (${ago(lastOkAt)})` };
    case Outcome.OK_EMPTY:
      return { cls: "muted", text: `reading fine, nothing listed (${ago(lastOkAt)})` };
    case Outcome.DATE_FALLBACK:
      return { cls: "muted", text: `reading fine, your date is not on sale (${ago(lastOkAt)})` };
    case Outcome.BLOCKED:
      return { cls: "warn", text: `BookMyShow is refusing us - last clean read ${ago(lastOkAt)}` };
    case Outcome.BAD_CODE:
      return { cls: "warn", text: "booking code looks wrong - this watch cannot fire" };
    case Outcome.UNPARSEABLE:
      return { cls: "warn", text: "BookMyShow changed its page - the parser needs updating" };
    default:
      return { cls: "warn", text: `last read: ${lastOutcome} (${ago(lastOkAt)})` };
  }
}

export default async function Home() {
  const user = await currentUser();
  if (!user) {
    return (
      <>
        <h1>Drop Watcher</h1>
        <p className="muted">
          Tells you the moment a BookMyShow date goes on sale — including a date
          that has no shows yet, which is the one you usually care about.
        </p>
        <p>You need an invite link to use this.</p>
      </>
    );
  }

  const rows = await db
    .select({ sub: subscriptions, target: targets })
    .from(subscriptions)
    .innerJoin(targets, eq(subscriptions.targetId, targets.id))
    .where(eq(subscriptions.userId, user.id))
    .orderBy(desc(subscriptions.createdAt));

  const [channel] = await db.select().from(channels).where(eq(channels.userId, user.id)).limit(1);
  const topic = (channel?.config as { topic?: string } | undefined)?.topic;

  return (
    <>
      <h1>Your watches</h1>
      <p className="muted">Signed in as {user.email}</p>

      {topic ? (
        <div className="card">
          <strong>Your notification topic</strong>
          <p className="muted" style={{ margin: ".35rem 0" }}>
            Subscribe to this in the ntfy app. It is yours alone — nothing you tap
            can affect anyone else&apos;s alerts.
          </p>
          <code>{topic}</code>
        </div>
      ) : null}

      <h2>Watching</h2>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet. <a href="/new">Add a watch</a>.</p>
      ) : (
        rows.map(({ sub, target }) => {
          const h = health(target.lastOutcome, target.lastOkAt);
          return (
            <div className="card" key={sub.id}>
              <div className="row">
                <strong>{target.title}</strong>
                <span className="muted">{target.city}</span>
                <span className="pill">{pretty(sub.showDate)}</span>
                <span className="pill">
                  {sub.state === "armed" ? "waiting"
                    : sub.state === "fired" ? "on sale - told you" : "silenced"}
                </span>
                {sub.kind !== "date" ? <span className="pill">{sub.venueEntry}</span> : null}
              </div>
              <div className={h.cls} style={{ fontSize: ".85rem", marginTop: ".35rem" }}>
                {h.text}
              </div>
              <form
                method="post"
                action={sub.state === "acked" ? `/s/${sub.id}/unack` : `/s/${sub.id}/ack`}
                style={{ marginTop: ".5rem" }}
              >
                <button className="secondary" type="submit">
                  {sub.state === "acked" ? "Watch this again" : "Stop alerts for this date"}
                </button>
              </form>
            </div>
          );
        })
      )}

      <p style={{ marginTop: "1.5rem" }}><a href="/new">Add a watch</a></p>
    </>
  );
}
