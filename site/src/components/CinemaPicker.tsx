"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { Cinema } from "../lib/cinemas.js";
import { formatChoices } from "../lib/format.js";

export interface CinemaPick { code: string; screens: string[] }

/**
 * Narrowing a watch to particular cinemas and screens — always optional.
 *
 * Two things this gets right that the first version did not.
 *
 * Screens hang off each CINEMA. "PCX at Prasads, HDR By Barco at AMB" is what
 * people actually want, and a single watch-wide format filter cannot say it —
 * it would also fire for HDR at Prasads. So a picked cinema reveals its own
 * formats.
 *
 * Every format is offered. The first version filtered the list through a
 * hardcoded regex of format words and capped it at six, which silently dropped
 * HDR By Barco — exactly the sort of screen somebody builds a watch around.
 *
 * The armed line is visible even COLLAPSED, because a premiere has no venue
 * list to choose from, and anyone who thinks they must pick a cinema first
 * would abandon setup in the case this product exists for.
 */
export function CinemaPicker({
  city, cinemas, initialPicks = [], initialScreens = [],
}: {
  city: string;
  cinemas: Cinema[];
  initialPicks?: CinemaPick[];
  initialScreens?: string[];
}) {
  const [open, setOpen] = useState(initialPicks.length > 0 || initialScreens.length > 0);
  const [picks, setPicks] = useState<CinemaPick[]>(initialPicks);
  const [screens, setScreens] = useState<string[]>(initialScreens);

  const anyCinemaFormats = formatChoices(cinemas.flatMap((c) => c.screens));
  const byCode = new Map(picks.map((p) => [p.code, p]));
  const chosen = cinemas.filter((c) => byCode.has(c.code));

  const shortName = (n: string) => n.split(":")[0]!.trim();
  const summary = (() => {
    const where = picks.length === 0
      ? "Any cinema"
      : picks.length <= 2 ? chosen.map((c) => shortName(c.name)).join(", ") || `${picks.length} cinemas`
      : `${picks.length} cinemas`;
    const narrowed = picks.length > 0
      ? picks.some((p) => p.screens.length > 0) ? "chosen screens" : "any screen"
      : screens.length > 0 ? screens.join(", ") : "any screen";
    return `${where} · ${narrowed}`;
  })();

  const armed = picks.length === 0 && screens.length === 0
    ? `Nothing picked means every cinema in ${city}. This watch is fully armed as it is.`
    : picks.length > 0
      ? `Only ${chosen.map((c) => {
          const p = byCode.get(c.code)!;
          return p.screens.length ? `${shortName(c.name)} (${p.screens.join(", ")})` : shortName(c.name);
        }).join(", ")}. Clear it to go back to every cinema.`
      : `Any cinema in ${city}, but only ${screens.join(" or ")}. Clear it to go back to every screen.`;

  function toggleCinema(code: string) {
    setPicks((prev) =>
      prev.some((p) => p.code === code)
        ? prev.filter((p) => p.code !== code)
        : [...prev, { code, screens: [] }]);
  }

  function toggleCinemaScreen(code: string, screen: string) {
    setPicks((prev) => prev.map((p) =>
      p.code !== code ? p
        : { ...p, screens: p.screens.includes(screen)
            ? p.screens.filter((s) => s !== screen)
            : [...p.screens, screen] }));
  }

  function toggleGlobalScreen(screen: string) {
    setScreens((prev) =>
      prev.includes(screen) ? prev.filter((s) => s !== screen) : [...prev, screen]);
  }

  const chip = (on: boolean) =>
    `flex min-h-[40px] items-center border-2 px-3 text-left text-[14px] font-extrabold ${
      on ? "border-accent-600 bg-accent-600 text-white" : "border-divider text-ink"
    }`;

  return (
    <section className="border-y-2 border-divider">
      <input type="hidden" name="cinemaPicks" value={JSON.stringify(picks)} />
      {screens.map((s) => <input key={s} type="hidden" name="screenFilters" value={s} />)}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Cinemas and screens · optional
          </span>
          <span className="truncate text-base font-extrabold tracking-tight1">{summary}</span>
        </span>
        <ChevronDown
          size={20} strokeWidth={2.5}
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <p className="flex items-start gap-1.5 pb-3 text-[13px] leading-[1.45] text-accent-700">
        <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" />
        <span>{armed}</span>
      </p>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {cinemas.length === 0 ? (
            <p className="pb-4 text-[15px] text-neutral-800">
              We haven&apos;t seen {city}&apos;s cinemas yet, so there&apos;s nothing to pick from.
              That&apos;s fine: your watch covers every cinema, and once shows appear you can
              narrow it from this page.
            </p>
          ) : (
            <div className="pb-4">
              {picks.length === 0 && anyCinemaFormats.length > 0 ? (
                <>
                  <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
                    Screens · any cinema
                  </span>
                  <p className="mt-1 text-[13px] text-neutral-700">
                    Pick as many as you like. Or tick a cinema below to choose screens there
                    specifically.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {anyCinemaFormats.map((s) => (
                      <button key={s} type="button" onClick={() => toggleGlobalScreen(s)}
                              className={chip(screens.includes(s))}>
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <p className="mt-4 text-[13px] text-neutral-700">
                Cinemas we&apos;ve seen in {city}, and the screens we&apos;ve spotted at each —
                not a promise for your date.
              </p>

              <ul className="mt-2">
                {cinemas.map((c) => {
                  const pick = byCode.get(c.code);
                  const on = Boolean(pick);
                  const formats = formatChoices(c.screens);
                  return (
                    <li key={c.code} className="border-t border-divider">
                      <button
                        type="button"
                        onClick={() => toggleCinema(c.code)}
                        aria-pressed={on}
                        className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left"
                      >
                        <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-2 ${
                          on ? "border-accent-600 bg-accent-600" : "border-divider"
                        }`}>
                          {on ? <Check size={14} strokeWidth={3} className="text-white" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{c.name}</span>
                          {!on && formats.length > 0 ? (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {formats.map((s) => (
                                <span key={s} className="border border-divider px-1.5 py-0.5 text-[11px] text-neutral-700">
                                  {s}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>

                      {on ? (
                        <div className="pb-3 pl-[34px]">
                          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
                            Screens here · {pick!.screens.length === 0 ? "any" : pick!.screens.length}
                          </span>
                          {formats.length === 0 ? (
                            <p className="mt-1 text-[13px] text-neutral-700">
                              No screens seen here yet — this cinema counts on any screen.
                            </p>
                          ) : (
                            <>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {formats.map((s) => (
                                  <button key={s} type="button"
                                          onClick={() => toggleCinemaScreen(c.code, s)}
                                          className={chip(pick!.screens.includes(s))}>
                                    {s}
                                  </button>
                                ))}
                              </div>
                              <p className="mt-2 text-[12px] text-neutral-700">
                                A screen counts whatever is playing on it — 2D, 3D or anything
                                else.
                              </p>
                            </>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {(picks.length > 0 || screens.length > 0) ? (
                <button
                  type="button"
                  onClick={() => { setPicks([]); setScreens([]); }}
                  className="mt-3 min-h-[44px] text-[15px] font-extrabold text-accent-700 underline"
                >
                  Back to any cinema
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
