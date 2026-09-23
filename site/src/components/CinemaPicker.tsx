"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { Cinema } from "../lib/cinemas.js";

/**
 * Narrowing a watch to particular cinemas or screens — always optional.
 *
 * The line about being armed is shown even when the picker is COLLAPSED, and
 * that is the point of the component. A premiere has no venue list to choose
 * from, so anyone who believes they must pick a cinema before the watch counts
 * would abandon setup in exactly the case this product exists for. The default
 * is every cinema, and the UI says so without being opened.
 */
export function CinemaPicker({
  city, cinemas, initialCodes = [], initialScreen = null,
}: {
  city: string;
  cinemas: Cinema[];
  initialCodes?: string[];
  initialScreen?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>(initialCodes);
  const [screen, setScreen] = useState<string | null>(initialScreen);

  const screens = [...new Set(cinemas.flatMap((c) => c.screens))]
    .filter((s) => /imax|atmos|4dx|pxl|pcx|dolby/i.test(s))
    .slice(0, 6);

  const chosen = cinemas.filter((c) => codes.includes(c.code));
  const summary = (() => {
    const where = chosen.length === 0
      ? "Any cinema"
      : chosen.length <= 2 ? chosen.map((c) => c.name.split(":")[0]).join(", ") : `${chosen.length} cinemas`;
    return `${where} · ${screen ?? "any screen"}`;
  })();

  const armed = codes.length === 0 && !screen
    ? `Nothing picked means every cinema in ${city}. This watch is fully armed as it is.`
    : `Only ${chosen.length ? chosen.map((c) => c.name.split(":")[0]).join(", ") : "every cinema"}${
        screen ? `, ${screen} screens` : ""
      }. Clear it to go back to every cinema.`;

  function toggle(code: string) {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <section className="border-y-2 border-divider">
      {/* The chosen values travel with the form, so the picker needs no state
          on the server and works identically on create and on refine. */}
      {codes.map((c) => <input key={c} type="hidden" name="cinemaCodes" value={c} />)}
      {screen ? <input type="hidden" name="screenFilter" value={screen} /> : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Cinemas and screens · optional
          </span>
          <span className="text-base font-extrabold tracking-tight1">{summary}</span>
        </span>
        <ChevronDown
          size={20}
          strokeWidth={2.5}
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
              narrow it from the watch&apos;s page.
            </p>
          ) : (
            <div className="pb-4">
              {screens.length > 0 ? (
                <>
                  <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
                    Screen format
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[null, ...screens].map((s) => (
                      <button
                        key={s ?? "any"}
                        type="button"
                        onClick={() => setScreen(s)}
                        className={`flex h-10 items-center border-2 px-3 text-[14px] font-extrabold ${
                          screen === s
                            ? "border-accent-600 bg-accent-600 text-white"
                            : "border-divider text-ink"
                        }`}
                      >
                        {s ?? "Any screen"}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <p className="mt-4 text-[13px] text-neutral-700">
                Cinemas we&apos;ve seen in {city}. Formats are what we&apos;ve spotted there
                before, not a promise for your date.
              </p>

              <ul className="mt-2">
                {cinemas.map((c) => {
                  const on = codes.includes(c.code);
                  return (
                    <li key={c.code} className="border-t border-divider">
                      <button
                        type="button"
                        onClick={() => toggle(c.code)}
                        aria-pressed={on}
                        className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left"
                      >
                        <span
                          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-2 ${
                            on ? "border-accent-600 bg-accent-600" : "border-divider"
                          }`}
                        >
                          {on ? <Check size={14} strokeWidth={3} className="text-white" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{c.name}</span>
                          {c.screens.length > 0 ? (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {c.screens.slice(0, 3).map((s) => (
                                <span key={s} className="border border-divider px-1.5 py-0.5 text-[11px] text-neutral-700">
                                  {s}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {(codes.length > 0 || screen) ? (
                <button
                  type="button"
                  onClick={() => { setCodes([]); setScreen(null); }}
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
