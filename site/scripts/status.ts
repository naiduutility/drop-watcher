/**
 * What every live watch is actually doing, right now.
 *
 * "Is it working?" has three separate answers — is the target being read, is
 * the read conclusive, and is this person's subscription still armed — and
 * until now answering it meant three queries and a mental join. On the night
 * before a release that is exactly the wrong time to be doing that.
 *
 * Prints no topic, no email and no connection string: the repo is public and
 * this output is the kind of thing that gets pasted into a chat.
 *
 *   npm run status
 */

import { desc, gte, inArray } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { checks, subscriptions, targets, users } from "../src/db/schema.js";
import { BASE_INTERVAL_MS, daysUntil, effectivePriority } from "../src/core/schedule.js";
import { WHOLE_DATE } from "../src/lib/alertkeys.js";

function mins(from: Date | null, now: Date): string {
  if (!from) return "never";
  const m = Math.round((now.getTime() - from.getTime()) / 60_000);
  return m < 0 ? `in ${-m}m` : `${m}m ago`;
}

function pretty(yyyymmdd: string): string {
  if (yyyymmdd === WHOLE_DATE) return "first day when it opens";
  const [y, m, d] = [yyyymmdd.slice(0, 4), yyyymmdd.slice(4, 6), yyyymmdd.slice(6, 8)];
  return `${d}/${m}/${y}`;
}

async function main() {
  const now = new Date();

  const subs = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
  if (subs.length === 0) {
    console.log("No watches at all.");
    process.exit(0);
  }

  const ts = await db.select().from(targets)
    .where(inArray(targets.id, [...new Set(subs.map((s) => s.targetId))]));
  const byId = new Map(ts.map((t) => [t.id, t]));

  const who = await db.select({ id: users.id, name: users.displayName }).from(users);
  const nameOf = new Map(who.map((u) => [u.id, u.name ?? "someone"]));

  // Block rate over the last hour, the number that decides whether tonight
  // works. Counted per outcome rather than pass/fail: "blocked" and
  // "page_error" mean different things to fix.
  const recent = await db.select({ outcome: checks.outcome, targetId: checks.targetId })
    .from(checks).where(gte(checks.at, new Date(now.getTime() - 3600_000)));
  const tally = new Map<string, number>();
  for (const c of recent) tally.set(c.outcome, (tally.get(c.outcome) ?? 0) + 1);

  console.log(`\n=== ${subs.length} watch(es), ${ts.length} distinct scrape(s) ===\n`);

  for (const sub of subs) {
    const t = byId.get(sub.targetId);
    if (!t) continue;

    const narrowing = sub.cinemaPicks.length > 0
      ? sub.cinemaPicks.map((p) => `${p.code}${p.screens.length ? ` [${p.screens.join(", ")}]` : " (any screen)"}`).join("; ")
      : sub.screenFilters.length > 0
        ? `any cinema, only: ${sub.screenFilters.join(", ")}`
        : "every cinema in the city";

    const onSale = t.offeredDates.includes(sub.showDate);
    const overdue = t.nextDueAt.getTime() < now.getTime() - 5 * 60_000;

    console.log(`${t.title}  (${t.city})`);
    console.log(`  watching     ${pretty(sub.showDate)} · for ${nameOf.get(sub.userId)}`);
    console.log(`  narrowed to  ${narrowing}`);
    console.log(`  subscription ${sub.state}${sub.ackedKeys.length ? ` · silenced: ${sub.ackedKeys.join(", ")}` : ""}`);
    console.log(`  announced    ${sub.notifiedKeys.length ? sub.notifiedKeys.join(", ") : "nothing yet"}`);
    const actual = effectivePriority(t.priority, t.releaseDate, now);
    const every = (p: typeof actual) => {
      const m = Math.round(BASE_INTERVAL_MS[p] / 60_000);
      return m >= 60 ? `every ${Math.round(m / 60)}h` : `every ${m} min`;
    };
    const days = daysUntil(t.releaseDate, now);
    console.log(`  target       ${t.status} · ${t.priority} (${every(t.priority)})`
      + (actual !== t.priority ? `  -> sped up to ${actual} (${every(actual)}), ${days}d to release` : ""));
    console.log(`  booking code ${t.bookCode || "NOT RESOLVED YET — watching the film page"}`);
    console.log(`  last read    ${t.lastOutcome ?? "none"} ${mins(t.lastCheckedAt, now)}`
      + ` · last clean ${mins(t.lastOkAt, now)}`
      + (t.consecutiveInconclusive ? ` · ${t.consecutiveInconclusive} inconclusive in a row` : ""));
    console.log(`  next check   ${mins(t.nextDueAt, now)}${overdue ? "  <-- OVERDUE, is the cron running?" : ""}`);
    console.log(`  dates listed ${t.offeredDates.length ? t.offeredDates.join(", ") : "none"}`
      + (onSale ? "   <-- THIS DATE IS ON SALE" : ""));
    console.log("");
  }

  // Targets nobody watches. They cost no BookMyShow requests once retired, but
  // an ACTIVE one with no subscribers is the bug that put deleted films back in
  // the worker log, so it is worth saying out loud rather than filtering away.
  const all = await db.select({ id: targets.id, title: targets.title, status: targets.status })
    .from(targets);
  const watched = new Set(subs.map((s) => s.targetId));
  const orphans = all.filter((t) => !watched.has(t.id));
  if (orphans.length > 0) {
    console.log("=== not watched by anyone ===");
    for (const o of orphans) {
      console.log(`  ${o.status.padEnd(10)} ${o.title}`
        + (o.status === "retired" ? "" : "   <-- still being scraped, should be retired"));
    }
    console.log("");
  }

  console.log("=== reads in the last hour ===");
  if (recent.length === 0) {
    console.log("  NOTHING. The worker has not run — check the cron job.\n");
  } else {
    for (const [outcome, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${outcome}`);
    }
    const blocked = (tally.get("blocked") ?? 0) + (tally.get("page_error") ?? 0);
    console.log(`\n  ${Math.round((blocked / recent.length) * 100)}% of reads learned nothing.`);
    console.log("  Retries and the degraded alert cover this; above ~80% is worth worrying about.\n");
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
