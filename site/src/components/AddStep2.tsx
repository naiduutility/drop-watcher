"use client";

import { useState } from "react";
import { Bell, Hourglass, LoaderCircle, MapPin, Ticket } from "lucide-react";

import { CinemaPicker } from "./CinemaPicker.js";
import type { Cinema } from "../lib/cinemas.js";
import { dateParts, nameList, type Member } from "../lib/view.js";

/**
 * Choosing dates.
 *
 * The critical detail is that a date with nothing on sale is a NORMAL,
 * full-contrast choice — dashed rather than dimmed. It is the reason the
 * product exists: a premiere is invisible on BookMyShow until it is not, and
 * an interface that greyed it out would be steering people away from the only
 * date they came to pick.
 */
export function AddStep2({
  action, url, film, city, language, dates, onSale, alreadyMine, cinemas, friends, defaultDate,
}: {
  action: (form: FormData) => void;
  url: string;
  film: string;
  city: string;
  language: string | null;
  dates: string[];
  onSale: string[];
  alreadyMine: Record<string, string>;
  cinemas: Cinema[];
  friends: Member[];
  defaultDate: string | null;
}) {
  const [picked, setPicked] = useState<string[]>(
    defaultDate && !alreadyMine[defaultDate] ? [defaultDate] : [],
  );
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(d: string) {
    if (alreadyMine[d]) { setRefused(d); return; }
    setRefused(null);
    setPicked((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  return (
    <form action={action} onSubmit={() => setBusy(true)} className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <input type="hidden" name="url" value={url} />
      {picked.map((d) => <input key={d} type="hidden" name="dates" value={d} />)}

      <div className="flex-1 px-4 pb-6 pt-5">
        <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
          We found
        </span>
        <h1 className="mt-1 text-[34px] font-extrabold leading-[.96] tracking-tight2">{film}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="flex items-center gap-1.5 border border-divider px-2 py-1 text-[13px] text-neutral-700">
            <MapPin size={14} strokeWidth={2.5} />{city}
          </span>
          {language ? (
            <span className="border border-divider px-2 py-1 text-[13px] capitalize text-neutral-700">
              {language}
            </span>
          ) : null}
        </div>

        {friends.length > 0 ? (
          <section className="mt-5 flex items-center gap-3 bg-ink p-3.5 text-bg">
            <span className="flex shrink-0">
              {friends.slice(0, 3).map((f, i) => (
                <span
                  key={f.id}
                  className="flex h-9 w-9 items-center justify-center bg-bg text-sm font-extrabold text-ink"
                  style={{ marginLeft: i === 0 ? 0 : -8 }}
                >
                  {f.name.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
            <span>
              <span className="block text-[17px] font-extrabold leading-tight">
                {nameList(friends)} {friends.length === 1 ? "is" : "are"} watching this.
                You&apos;ll join them.
              </span>
              <span className="mt-0.5 block text-[13px] opacity-80">
                Your alerts stay your own.
              </span>
            </span>
          </section>
        ) : null}

        <h2 className="mt-7 text-xl font-extrabold tracking-tight1">Which dates?</h2>
        <p className="mt-1.5 text-[15px] leading-[1.45] text-neutral-800">
          Pick as many as you like. Dates with nothing on sale yet are the whole point: that&apos;s
          where a premiere appears.
        </p>

        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-neutral-700">
          <span className="flex items-center gap-1.5"><Ticket size={14} strokeWidth={2.5} />On sale</span>
          <span className="flex items-center gap-1.5"><Hourglass size={14} strokeWidth={2.5} />Not yet</span>
          <span className="flex items-center gap-1.5"><Bell size={14} strokeWidth={2.5} />Already yours</span>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1">
          {dates.map((d) => {
            const { weekday, day } = dateParts(d);
            const mine = Boolean(alreadyMine[d]);
            const live = onSale.includes(d);
            const on = picked.includes(d);
            const base = "flex min-h-[70px] flex-col items-center justify-center gap-0.5 transition-transform duration-75 active:scale-95";
            const look = mine
              ? "bg-neutral-200 text-neutral-600"
              : on
                ? "bg-accent-600 text-white"
                : live
                  ? "border-2 border-divider"
                  : "border-2 border-dashed border-divider";
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                aria-pressed={on}
                className={`${base} ${look}`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-[.08em]">{weekday}</span>
                <span className="text-xl font-extrabold leading-none tabular-nums">{day}</span>
                {mine ? <Bell size={13} strokeWidth={2.5} />
                  : live ? <Ticket size={13} strokeWidth={2.5} />
                  : <Hourglass size={13} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>

        {refused ? (
          <div className="mt-3 border-2 border-ink p-3">
            <p className="text-[15px]">
              You already watch <strong>{dateParts(refused).short}</strong> for this film. One
              watch per date.
            </p>
            <a
              href={`/w/${alreadyMine[refused]}`}
              className="mt-2 flex min-h-[44px] items-center justify-between border-2 border-divider px-3 text-[15px] font-extrabold text-ink no-underline"
            >
              <span>Open it</span>
              <Bell size={16} strokeWidth={2.5} />
            </a>
          </div>
        ) : null}

        <div className="mt-4 border-t border-divider pt-3">
          {picked.length === 0 ? (
            <p className="text-[15px] text-neutral-700">No dates picked yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...picked].sort().map((d) => (
                <li key={d} className="text-[15px]">
                  <strong>{dateParts(d).short}</strong>{" "}
                  <span className="text-neutral-700">
                    {onSale.includes(d)
                      ? "On sale now. We'll alert you on the first check."
                      : "Not on sale yet. We'll wait for it."}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="mt-6 block">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Name in your alerts
          </span>
          <input
            name="title"
            defaultValue={film}
            className="mt-2 w-full border-2 border-divider bg-transparent px-3 py-3 text-[15px] outline-none"
          />
          <span className="mt-1 block text-[13px] text-neutral-700">
            Your notification will read “{film} is on sale”.
          </span>
        </label>

        <div className="mt-6">
          <CinemaPicker city={city} cinemas={cinemas} />
        </div>
      </div>

      <div className="sticky bottom-0 border-t-2 border-divider bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="mb-2 text-[13px] text-neutral-700">
          {picked.length === 0
            ? "Pick at least one date"
            : `Any cinema in ${city} unless you narrow it · alerts go to your ntfy`}
        </p>
        <button
          type="submit"
          disabled={picked.length === 0 || busy}
          className="flex min-h-[54px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white transition-transform duration-75 active:scale-[.98] disabled:opacity-45"
        >
          <span>{busy ? "Starting…" : `Start watching ${picked.length || ""} ${picked.length === 1 ? "date" : "dates"}`.trim()}</span>
          {busy
            ? <LoaderCircle size={20} strokeWidth={2.5} className="animate-spin1s" />
            : <Bell size={20} strokeWidth={2.5} />}
        </button>
      </div>
    </form>
  );
}
