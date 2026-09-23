import Link from "next/link";
import {
  ArrowUpRight, Bell, BellOff, Check, Clock, EyeOff, LoaderCircle, Ticket,
} from "lucide-react";

import { dateParts, type WatchView } from "../lib/view.js";

/**
 * One watch, in one of five states.
 *
 * Every state gets its own fill or border treatment, its own icon AND its own
 * words. Status is never carried by colour alone — partly for contrast and
 * colour-blindness, but mostly because the difference between "relax" and "go
 * now" is too important to encode in a hue someone might be glancing past.
 *
 * The whole card links to the detail page, except the Book button, which goes
 * straight to BookMyShow. Nothing may be allowed to add a tap between a
 * notification and buying a ticket.
 */

const KICKER = "flex items-center gap-2 text-xs font-extrabold uppercase tracking-kicker";

function DateColumn({ date, rule }: { date: string; rule: string }) {
  const { weekday, day, month } = dateParts(date);
  return (
    <div className={`flex flex-col items-start py-3.5 pl-3.5 border-r-2 ${rule}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[.1em]">{weekday}</span>
      <span className="text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{day}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[.1em]">{month}</span>
    </div>
  );
}

export function WatchCard({ watch }: { watch: WatchView }) {
  const href = `/w/${watch.id}`;
  const mins = watch.minutesSinceCleanRead;

  if (watch.state === "on_sale") {
    return (
      <article className="grid grid-cols-[68px_minmax(0,1fr)] bg-accent-600 text-white">
        <DateColumn date={watch.showDate} rule="border-white/45" />
        <div className="flex flex-col gap-2.5 p-3.5">
          <div className={KICKER}><Ticket size={16} strokeWidth={2.5} /><span>On sale now</span></div>
          <Link href={href} className="flex flex-col gap-0.5 text-white no-underline">
            <span className="text-xl font-extrabold leading-[1.1] tracking-tight1">{watch.title}</span>
            <span className="text-sm font-semibold">
              {watch.city} · {watch.venuesListed ?? 0} cinemas listed
            </span>
          </Link>
          <a
            href={watch.bookUrl}
            className="flex min-h-[48px] items-center justify-between bg-white px-3.5 text-base font-extrabold text-onred no-underline transition-transform duration-75 active:scale-[.98]"
          >
            <span>Book on BookMyShow</span>
            <ArrowUpRight size={20} strokeWidth={2.5} />
          </a>
        </div>
      </article>
    );
  }

  if (watch.state === "cant_read") {
    return (
      <article className="bg-hazard-bg text-hazard-fg">
        {/* Hazard tape. The one moment in a flat design that shouts. */}
        <div
          className="h-2"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, var(--color-accent) 0 8px, #201e1d 8px 16px)",
          }}
        />
        <div className="grid grid-cols-[68px_minmax(0,1fr)]">
          <DateColumn date={watch.showDate} rule="border-[#f3f2f2]/30" />
          <div className="flex flex-col gap-2 p-3.5">
            <div className={`${KICKER} text-accent-400`}>
              <EyeOff size={16} strokeWidth={2.5} />
              <span>Can&apos;t read · {mins ?? "?"} min</span>
            </div>
            <Link href={href} className="flex flex-col gap-1 text-hazard-fg no-underline">
              <span className="text-xl font-extrabold leading-[1.1] tracking-tight1">{watch.title}</span>
              <span className="text-sm leading-[1.4]">
                No clean read for {mins ?? "?"} minutes. We can&apos;t tell you whether tickets are out.
              </span>
            </Link>
            <a
              href={watch.bookUrl}
              className="flex min-h-[44px] items-center justify-between border-2 border-[#f3f2f2] px-3.5 text-[15px] font-extrabold text-hazard-fg no-underline hover:bg-[#f3f2f2]/10"
            >
              <span>Check BookMyShow yourself</span>
              <ArrowUpRight size={18} strokeWidth={2.5} />
            </a>
          </div>
        </div>
      </article>
    );
  }

  if (watch.state === "silenced") {
    return (
      <article className="grid grid-cols-[68px_minmax(0,1fr)] border-2 border-neutral-300 text-neutral-700">
        <DateColumn date={watch.showDate} rule="border-neutral-300" />
        <div className="flex flex-col gap-2 p-3.5">
          <div className={KICKER}><BellOff size={16} strokeWidth={2.5} /><span>Silenced · no alerts</span></div>
          <Link href={href} className="flex flex-col gap-0.5 text-neutral-700 no-underline">
            <span className="text-lg font-extrabold leading-[1.15] tracking-tight1">{watch.title}</span>
            <span className="text-sm">{watch.city}</span>
          </Link>
          <form action={`/s/${watch.id}/unack`} method="post">
            <button
              type="submit"
              className="flex min-h-[44px] w-full items-center justify-between border-2 border-neutral-300 px-3.5 text-[15px] font-extrabold text-ink"
            >
              <span>Watch again</span>
              <Bell size={18} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </article>
    );
  }

  if (watch.state === "new") {
    return (
      <article className="grid grid-cols-[68px_minmax(0,1fr)] border-2 border-dashed border-divider">
        <DateColumn date={watch.showDate} rule="border-divider" />
        <div className="flex flex-col gap-2 p-3.5">
          <div className={`${KICKER} text-neutral-700`}>
            <LoaderCircle size={16} strokeWidth={2.5} className="animate-spin1s" />
            <span>First check pending · a few minutes</span>
          </div>
          <Link href={href} className="flex flex-col gap-0.5 text-ink no-underline">
            <span className="text-lg font-extrabold leading-[1.15] tracking-tight1">{watch.title}</span>
            <span className="text-sm text-neutral-700">{watch.city}</span>
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="grid grid-cols-[68px_minmax(0,1fr)] bg-surface transition-colors hover:bg-neutral-300">
      <DateColumn date={watch.showDate} rule="border-divider" />
      <div className="flex flex-col gap-2 p-3.5">
        <div className={KICKER}><Clock size={16} strokeWidth={2.5} /><span>Waiting · not on sale yet</span></div>
        <Link href={href} className="flex flex-col gap-0.5 text-ink no-underline">
          <span className="text-lg font-extrabold leading-[1.15] tracking-tight1">{watch.title}</span>
          <span className="text-sm text-neutral-800">{watch.city}</span>
        </Link>
        <div className="flex items-center gap-1.5 text-[13px] text-neutral-700">
          <Check size={14} strokeWidth={2.5} />
          <span>Reading fine · checked {watch.lastCleanReadAt ? `${watch.minutesSinceCleanRead} min ago` : "—"}</span>
        </div>
      </div>
    </article>
  );
}
