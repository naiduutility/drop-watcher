import {
  ArrowUpRight, Bell, BellOff, Check, Clock, EyeOff, LoaderCircle, Ticket, X,
} from "lucide-react";

import { dateParts, nameList, type Member, type WatchState } from "../lib/view.js";

export interface CheckCell { ok: boolean; label: string }

/**
 * The top of a watch's own page, in whichever of five states it is in.
 *
 * The strip of recent checks is the quiet star here: twelve cells saying what
 * the last twelve reads actually did. It is what lets someone answer "is this
 * working?" without asking anybody, which on 2026-09-22 took a day of forensics
 * across an ntfy cache and a saved HTML file.
 */
export function WatchHero({
  state, title, city, showDate, venueCount, seenAt, minutesBlind, lastCleanRead,
  friends, checks, bookUrl,
}: {
  state: WatchState;
  title: string;
  city: string;
  showDate: string;
  venueCount: number;
  seenAt: string | null;
  minutesBlind: number | null;
  lastCleanRead: string;
  friends: Member[];
  checks: CheckCell[];
  bookUrl: string;
}) {
  const when = dateParts(showDate);

  const strip = checks.length > 0 ? (
    <div className="mt-5">
      <div className="flex gap-[3px]">
        {checks.map((c, i) => (
          <span
            key={i}
            title={c.label}
            className={`flex h-[22px] flex-1 items-center justify-center ${
              state === "cant_read"
                ? c.ok ? "bg-neutral-700 text-hazard-fg" : "bg-accent text-white"
                : c.ok ? "bg-ink text-bg" : "bg-accent-600 text-white"
            }`}
          >
            {c.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
          </span>
        ))}
      </div>
      <p className={`mt-1.5 text-[12px] ${state === "cant_read" ? "text-[#f3f2f2]/70" : "text-neutral-700"}`}>
        Last {checks.length} checks ·{" "}
        {checks.every((c) => c.ok)
          ? "every one clean"
          : `${checks.filter((c) => !c.ok).length} blocked · last clean read ${lastCleanRead}`}
      </p>
    </div>
  ) : null;

  if (state === "on_sale") {
    return (
      <section className="bg-accent-600 text-white">
        <div className="mx-auto max-w-[880px] px-4 pb-5 pt-[22px]">
          <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-kicker">
            <Ticket size={16} strokeWidth={2.5} />On sale now
          </span>
          <h1 className="mt-2 text-[36px] font-extrabold leading-[.96] tracking-tight2">{title}</h1>
          <p className="mt-1 text-[15px] font-semibold">{when.long} · {city}</p>

          <div className="my-5 flex items-end gap-3 border-y border-white/50 py-4">
            <span className="text-[56px] font-extrabold leading-[.9] tracking-tight2 tabular-nums">
              {venueCount}
            </span>
            <span className="pb-1 text-[15px] font-semibold leading-tight">
              cinemas listed<br />
              <span className="font-normal opacity-90">{seenAt ? `found ${seenAt}` : ""}</span>
            </span>
          </div>

          <a
            href={bookUrl}
            className="flex min-h-[60px] items-center justify-between bg-white px-4 text-[19px] font-extrabold text-onred no-underline transition-transform duration-75 active:scale-[.98]"
          >
            <span>Book on BookMyShow</span>
            <ArrowUpRight size={22} strokeWidth={2.5} />
          </a>
        </div>
      </section>
    );
  }

  if (state === "cant_read") {
    return (
      <section role="alert" className="bg-hazard-bg text-hazard-fg">
        <div
          className="h-3.5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, var(--color-accent) 0 8px, #201e1d 8px 16px)",
          }}
        />
        <div className="mx-auto max-w-[880px] px-4 pb-5 pt-[22px]">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-[#f3f2f2]/70">
            {title} · {when.short}
          </span>
          <span className="mt-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-kicker text-accent-400">
            <EyeOff size={16} strokeWidth={2.5} />Can&apos;t read BookMyShow
          </span>
          <h1 className="mt-2 text-[36px] font-extrabold leading-[.96] tracking-tight2">
            We&apos;re blind to this watch.
          </h1>
          <div className="mt-4 flex items-end gap-3">
            <span className="text-[56px] font-extrabold leading-[.9] tracking-tight2 tabular-nums text-accent-400">
              {minutesBlind ?? "?"}
            </span>
            <span className="pb-1 text-[15px] leading-tight">minutes without<br />a clean read</span>
          </div>
          <p className="mt-4 text-[15px] leading-[1.5]">
            We can&apos;t tell you whether tickets are out. This is us failing, not a quiet box
            office.
          </p>
          {strip}
          <a
            href={bookUrl}
            className="mt-5 flex min-h-[56px] items-center justify-between border-2 border-[#f3f2f2] px-4 text-base font-extrabold text-hazard-fg no-underline hover:bg-[#f3f2f2]/10"
          >
            <span>Check BookMyShow yourself</span>
            <ArrowUpRight size={20} strokeWidth={2.5} />
          </a>
        </div>
      </section>
    );
  }

  if (state === "silenced") {
    return (
      <section className="border-b-2 border-divider">
        <div className="mx-auto max-w-[880px] px-4 pb-5 pt-[22px] text-neutral-700">
          <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-kicker">
            <BellOff size={16} strokeWidth={2.5} />Silenced
          </span>
          <h1 className="mt-2 text-[30px] font-extrabold leading-[1] tracking-tight2">{title}</h1>
          <p className="mt-1 text-[15px]">{when.long} · {city}</p>
          <p className="mt-4 text-[15px] leading-[1.5]">
            You won&apos;t get alerts for this date. We still check it
            {friends.length > 0 ? `, and ${nameList(friends)} still get theirs` : ""}.
          </p>
        </div>
      </section>
    );
  }

  if (state === "new") {
    return (
      <section className="border-b-2 border-dashed border-divider">
        <div className="mx-auto max-w-[880px] px-4 pb-5 pt-[22px]">
          <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-kicker text-neutral-700">
            <LoaderCircle size={16} strokeWidth={2.5} className="animate-spin1s" />
            First check pending
          </span>
          <h1 className="mt-2 text-[30px] font-extrabold leading-[1] tracking-tight2">{title}</h1>
          <p className="mt-1 text-[15px] text-neutral-700">{when.long} · {city}</p>
          <p className="mt-4 text-[15px] leading-[1.5] text-neutral-800">
            Your watch is armed. The first read usually lands within five minutes, and this page
            will say what we found.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface">
      <div className="mx-auto max-w-[880px] px-4 pb-5 pt-[22px]">
        <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
          {when.short} · {city}
        </span>
        <h1 className="mt-1.5 text-[30px] font-extrabold leading-[1] tracking-tight2">{title}</h1>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-divider">
            <Clock size={22} strokeWidth={2.5} />
          </span>
          <span>
            <span className="block text-[26px] font-extrabold leading-none tracking-tight1">
              Waiting. All good.
            </span>
            <span className="mt-1 block text-[15px] text-neutral-700">Not on sale yet</span>
          </span>
        </div>
        <p className="mt-4 text-[15px] leading-[1.5] text-neutral-800">
          We read BookMyShow cleanly {lastCleanRead}. Nothing is listed for {when.short} yet. The
          moment it is, your phone buzzes.
        </p>
        {strip}
      </div>
    </section>
  );
}

export { Bell };
