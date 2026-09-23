/**
 * Turning database rows into the five states the UI speaks.
 *
 * The whole design rests on one distinction: "nothing is on sale yet" and "we
 * cannot see BookMyShow at all" must never look alike. That decision is made
 * here, once, rather than in each component.
 */

import { Outcome } from "../engine/index.js";
import type { Subscription, Target } from "../db/schema.js";

export type WatchState = "waiting" | "on_sale" | "silenced" | "cant_read" | "new";

export interface Member { id: string; name: string }

export interface WatchView {
  id: string;
  title: string;
  city: string;
  showDate: string;               // YYYYMMDD
  state: WatchState;
  venuesListed?: number;
  lastCleanReadAt: Date | null;
  minutesSinceCleanRead: number | null;

  bookUrl: string;
  alsoWatching: Member[];
}

/**
 * How long without a conclusive read before a watch is called blind.
 *
 * Not zero, deliberately. BookMyShow refuses datacenter IPs intermittently and
 * the worker already retries three times inside a pass, so one 403 is noise,
 * not blindness. Crying wolf on every transient block would train people to
 * ignore the one state that most needs their attention.
 */
export const BLIND_AFTER_MINUTES = 15;

const INCONCLUSIVE: string[] = [
  Outcome.BLOCKED, Outcome.PAGE_ERROR, Outcome.UNPARSEABLE, Outcome.BAD_CODE,
];

export function minutesSince(then: Date | null, now = new Date()): number | null {
  return then ? Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000)) : null;
}

export function watchState(
  sub: Pick<Subscription, "state">,
  target: Pick<Target, "lastOutcome" | "lastCheckedAt" | "lastOkAt">,
  now = new Date(),
): WatchState {
  // The person's own choice outranks everything: a silenced watch is silenced
  // even while the target is blind, because they asked not to hear about it.
  if (sub.state === "acked") return "silenced";
  if (!target.lastCheckedAt) return "new";

  const blindFor = minutesSince(target.lastOkAt, now);
  const inconclusive = target.lastOutcome !== null && INCONCLUSIVE.includes(target.lastOutcome);
  // Never read cleanly at all, and already checked, counts as blind too —
  // otherwise a watch whose booking code is wrong would sit on "waiting"
  // forever, which is the exact lie this state exists to prevent.
  if (inconclusive && (blindFor === null || blindFor >= BLIND_AFTER_MINUTES)) {
    return "cant_read";
  }
  if (sub.state === "fired") return "on_sale";
  return "waiting";
}

/** en-IN date parts for the card's date column. */
export function dateParts(yyyymmdd: string) {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)),
  );
  return {
    weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
    day: String(d.getDate()).padStart(2, "0"),
    month: d.toLocaleDateString("en-IN", { month: "short" }),
    long: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }),
    short: d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }),
  };
}

export function ago(then: Date | null, now = new Date()): string {
  const mins = minutesSince(then, now);
  if (mins === null) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** "Meera and Arjun" / "Meera, Arjun and 2 others". */
export function nameList(members: Member[]): string {
  const names = members.map((m) => m.name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

/** The counts line under "Your watches", e.g. "1 on sale · 2 waiting". */
export function summarise(states: WatchState[]): string {
  const order: [WatchState, string][] = [
    ["on_sale", "on sale"], ["cant_read", "can't read"],
    ["waiting", "waiting"], ["new", "new"], ["silenced", "silenced"],
  ];
  const parts = order
    .map(([s, label]) => [states.filter((x) => x === s).length, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  return parts.join(" · ");
}

/** Cards sort by urgency, not by when they were added. */
const RANK: Record<WatchState, number> = {
  on_sale: 0, cant_read: 1, waiting: 2, new: 3, silenced: 4,
};

export function byUrgency(a: { state: WatchState }, b: { state: WatchState }): number {
  return RANK[a.state] - RANK[b.state];
}
