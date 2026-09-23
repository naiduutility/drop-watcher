/**
 * Turning one read into notifications.
 *
 * This is where 2026-09-22's two disasters are designed out:
 *
 *   The false alert — a read that did not confirm the requested date was
 *   reported as "shows are UP". Here, ONLY `mayAlert` may produce an
 *   `on_sale` event, and a subscription additionally has to match the date
 *   the payload was actually served for. No inference, ever.
 *
 *   The silence — after a stray tap, five runs in a row did nothing and
 *   looked identical to "no tickets yet". Here, a run of inconclusive reads
 *   produces a `degraded` event, so "the watch is broken" is something the
 *   user is TOLD rather than something they have to deduce.
 *
 * Pure: state in, events out. No database, no clock, no network.
 */

import { Outcome, mayAlert, screenMatches, type Reading, type Venue } from "../engine/index.js";
import {
  liveTargets, matchedTargets, unannounced, type AlertTarget,
} from "../lib/alertkeys.js";

export interface SubscriptionView {
  id: string;
  userId: string;
  showDate: string;
  /** Cinemas, each with the screens wanted THERE. An empty list means every
   *  cinema; an empty `screens` on a pick means every screen at that one. */
  cinemaPicks: { code: string; screens: string[] }[];
  /** Applies only when no cinema is picked. Any of these formats counts. */
  screenFilters: string[];
  state: "armed" | "fired" | "acked";
  firedAt: Date | null;
  remindersSent: number;
  /** Cinema+screen keys already announced. */
  notifiedKeys: string[];
  /** Cinema+screen keys silenced. */
  ackedKeys: string[];
}

export interface TargetView {
  id: string;
  title: string;
  city: string;
  lastOkAt: Date | null;
  degradedNotifiedAt: Date | null;
  /** Falls back to this when there has never been a conclusive read, so a
   *  target created a minute ago does not immediately announce itself as
   *  broken on its first blocked fetch. */
  createdAt: Date;
}

export type WatchEvent =
  | {
      kind: "on_sale";
      subscriptionId: string;
      userId: string;
      showDate: string;
      /** The venues that satisfied THIS subscription, not every venue found. */
      venues: Venue[];
      /** Exactly what is being announced, and exactly what "Got it" silences. */
      targets: AlertTarget[];
    }
  | {
      kind: "reminder";
      subscriptionId: string;
      userId: string;
      showDate: string;
      venues: Venue[];
      targets: AlertTarget[];
    }
  | {
      kind: "degraded";
      targetId: string;
      subscriptionIds: string[];
      userIds: string[];
      minutesSinceOk: number;
    };

export interface EventPolicy {
  /** How long an unacked alert waits before a single nudge. Yesterday's
   *  every-5-minute repeat was how people ended up mass-tapping buttons to
   *  clear their notification tray — which is what silenced the watch. */
  reminderAfterMs: number;
  maxReminders: number;
  /** No conclusive read for this long, with someone still waiting, means the
   *  watch is not working and its owner deserves to know. */
  degradedAfterMs: number;
  /** Don't repeat the degraded warning more often than this. */
  degradedRepeatMs: number;
}

export const DEFAULT_POLICY: EventPolicy = {
  reminderAfterMs: 10 * 60_000,
  maxReminders: 3,
  degradedAfterMs: 25 * 60_000,
  degradedRepeatMs: 6 * 60 * 60_000,
};

export interface PlanInput {
  target: TargetView;
  subscriptions: SubscriptionView[];
  reading: Reading;
  now: Date;
  policy?: EventPolicy;
}

/**
 * The venues satisfying one subscription, or null if it isn't satisfied.
 *
 * An empty `cinemaCodes` means every cinema. That default is doing real work:
 * a premiere has no venue list to pick from when the watch is created, so a
 * model where narrowing were required would be useless in exactly the case
 * this product exists for.
 */
function venuesFor(sub: SubscriptionView, reading: Reading): Venue[] | null {
  let hits = reading.venues;

  if (sub.cinemaPicks.length > 0) {
    // Screens are matched PER CINEMA. "PCX at Prasads, Dolby Cinema at Allu"
    // is two different questions, and a watch-wide format filter would answer
    // neither — it would also fire for Dolby at Prasads.
    const wanted = new Map(
      sub.cinemaPicks.map((p) => [p.code.toUpperCase(), p.screens] as const),
    );
    hits = hits.filter((v) => {
      const screens = wanted.get((v.code ?? "").toUpperCase());
      if (!screens) return false;
      if (screens.length === 0) return true; // any screen at this cinema
      return screens.some((s) => screenMatches(s, v));
    });
  } else if (sub.screenFilters.length > 0) {
    // No cinema chosen, so the formats apply everywhere. Any one of them is
    // enough: asking for IMAX or Dolby Cinema is a single intent.
    hits = hits.filter((v) => sub.screenFilters.some((s) => screenMatches(s, v)));
  }

  return hits.length > 0 ? hits : null;
}

export function planEvents(input: PlanInput): WatchEvent[] {
  const { target, subscriptions, reading, now } = input;
  const policy = input.policy ?? DEFAULT_POLICY;
  const events: WatchEvent[] = [];

  // Which date did we actually learn about? For OK_SHOWS the engine has
  // already proven servedDate === requestedDate; falling back to requestedDate
  // only covers the caller that pinned no date.
  const provenDate = reading.servedDate ?? reading.requestedDate;

  if (mayAlert(reading) && provenDate) {
    for (const sub of subscriptions) {
      if (sub.showDate !== provenDate) continue;
      if (sub.state === "acked") continue;

      const venues = venuesFor(sub, reading);
      if (!venues) continue;

      const matched = matchedTargets(sub.cinemaPicks, sub.screenFilters, reading.venues);
      const fresh = unannounced(matched, sub.notifiedKeys, sub.ackedKeys);
      const forTargets = (ts: AlertTarget[]) =>
        ts.some((t) => t.code === "*")
          ? venues
          : venues.filter((v) => ts.some((t) => t.code.toUpperCase() === (v.code ?? "").toUpperCase()));

      if (fresh.length > 0) {
        // Fires from ANY state but "acked", not only "armed". A date goes on
        // sale one cinema at a time, and the second one opening an hour later
        // is news — otherwise whichever multiplex listed first would decide
        // whether you ever hear about the screen you actually wanted.
        events.push({
          kind: "on_sale", subscriptionId: sub.id, userId: sub.userId,
          showDate: sub.showDate, venues: forTargets(fresh), targets: fresh,
        });
      } else if (
        sub.firedAt &&
        sub.remindersSent < policy.maxReminders &&
        now.getTime() - sub.firedAt.getTime() >= policy.reminderAfterMs
      ) {
        // Nudge only about what is still live: a screen already silenced must
        // not come back through the reminder.
        const live = liveTargets(matched, sub.ackedKeys);
        if (live.length > 0) {
          events.push({
            kind: "reminder", subscriptionId: sub.id, userId: sub.userId,
            showDate: sub.showDate, venues: forTargets(live), targets: live,
          });
        }
      }
    }
    return events;
  }

  // Inconclusive. Nothing may be inferred about any date — but a watch that
  // has not managed a real read in a long while is itself news.
  if (reading.outcome === Outcome.OK_EMPTY || reading.outcome === Outcome.DATE_FALLBACK) {
    return events; // Conclusive "not on sale". Healthy, quiet, correct.
  }

  const waiting = subscriptions.filter((s) => s.state === "armed");
  if (waiting.length === 0) return events;

  const since = target.lastOkAt ?? target.createdAt;
  const sinceOk = now.getTime() - since.getTime();
  const overdue = sinceOk >= policy.degradedAfterMs;
  if (!overdue) return events;

  const lastWarned = target.degradedNotifiedAt?.getTime() ?? null;
  if (lastWarned !== null && now.getTime() - lastWarned < policy.degradedRepeatMs) {
    return events;
  }

  events.push({
    kind: "degraded",
    targetId: target.id,
    subscriptionIds: waiting.map((s) => s.id),
    userIds: [...new Set(waiting.map((s) => s.userId))],
    minutesSinceOk: Math.floor(sinceOk / 60_000),
  });
  return events;
}
