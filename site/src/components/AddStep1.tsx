"use client";

import { useState } from "react";
import { ArrowRight, Check, ClipboardPaste, X } from "lucide-react";

import { parseBmsUrl } from "../lib/bms-url.js";

/**
 * Paste a link, and find out immediately whether it can work.
 *
 * Classified on every keystroke rather than on submit. The film-page mistake
 * is the single most likely way to end up with a watch that never fires, and
 * discovering that after pressing Continue — or worse, days later when no
 * alert ever came — is the outcome this screen exists to prevent.
 *
 * The same check runs again in the server action. This one is for the person.
 */
export function AddStep1({ initial = "" }: { initial?: string }) {
  const [url, setUrl] = useState(initial);
  const parsed = url.trim() ? parseBmsUrl(url) : null;
  const kind = parsed?.kind ?? "empty";

  const border =
    kind === "showtimes" ? "border-ink"
    : kind === "empty" ? "border-divider"
    : "border-accent-700";

  async function paste() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {
      // Clipboard permission denied — the field still works by typing.
    }
  }

  return (
    <form method="get" className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-6 pt-5">
        <h1 className="text-[32px] font-extrabold leading-[.98] tracking-tight2">
          Paste a showtimes link
        </h1>
        <p className="mt-2 text-[15px] leading-[1.5] text-neutral-800">
          The page you land on after tapping <strong>Book tickets</strong> — its address carries
          the code we need.
        </p>

        <div className={`mt-5 flex border-2 ${border}`}>
          <input
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://in.bookmyshow.com/movies/..."
            className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-[15px] text-ink outline-none placeholder:text-neutral-500"
          />
          <button
            type="button"
            onClick={paste}
            className="flex shrink-0 items-center gap-2 border-l-2 border-inherit px-3.5 text-[15px] font-extrabold"
          >
            <ClipboardPaste size={18} strokeWidth={2.5} />
            <span className="hidden sm:inline">Paste</span>
          </button>
        </div>

        {kind === "showtimes" ? (
          <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Check size={18} strokeWidth={2.5} />
            That&apos;s a showtimes link. Good to go.
          </p>
        ) : null}

        {kind === "movie" ? (
          <div className="mt-3 bg-accent-100 p-4 text-accent-900">
            <span className="text-[11px] font-extrabold uppercase tracking-kicker">
              Nearly · one more step
            </span>
            <h2 className="mt-1 text-[22px] font-extrabold leading-[1.1] tracking-tight1">
              That&apos;s the film&apos;s page. We need the page after it.
            </h2>
            <p className="mt-2 text-[15px] leading-[1.45]">
              The film page doesn&apos;t carry the booking code, and guessing it produces a watch
              that stays silent forever. Thirty seconds fixes it:
            </p>
            <ol className="mt-3 space-y-1.5 text-[15px]">
              <li><strong>1.</strong> Open the film on BookMyShow</li>
              <li><strong>2.</strong> Tap <strong>Book tickets</strong></li>
              <li><strong>3.</strong> Pick any date at all</li>
              <li><strong>4.</strong> Copy the address bar and paste it here</li>
            </ol>
          </div>
        ) : null}

        {kind === "unrecognised" ? (
          <p className="mt-3 flex items-start gap-2 text-[15px] text-accent-700">
            <X size={18} strokeWidth={2.5} className="mt-0.5 shrink-0" />
            <span>
              That isn&apos;t a BookMyShow link. Copy it from the BookMyShow app or site, then
              paste it here.
            </span>
          </p>
        ) : null}

        <section className="mt-8 border-t-2 border-divider pt-5">
          <h2 className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Where the link comes from
          </h2>
          <div className="mt-3 grid max-w-[360px] grid-cols-3 gap-2">
            {[
              { label: "Film page", note: "Book tickets" },
              { label: "Pick date", note: "any date" },
              { label: "Address bar", note: "copy this" },
            ].map((p) => (
              <figure key={p.label} className="m-0">
                <div className="flex aspect-[3/4] flex-col gap-1.5 border-2 border-ink p-2">
                  <span className="h-1.5 w-2/3 bg-neutral-400" />
                  <span className="h-1.5 w-1/2 bg-neutral-300" />
                  <span className="mt-auto flex h-5 items-center justify-center bg-accent-600 text-[9px] font-extrabold text-white">
                    {p.note}
                  </span>
                </div>
                <figcaption className="mt-1.5 text-[12px] font-semibold text-neutral-700">
                  {p.label}
                </figcaption>
              </figure>
            ))}
          </div>

          <p className="mt-4 text-[12px] font-extrabold uppercase tracking-kicker text-neutral-700">
            This one works
          </p>
          <p className="mt-1 break-all border-2 border-divider p-2 text-[13px]">
            …/the-paradise/<mark className="bg-accent-200 px-0.5 text-accent-900">buytickets</mark>/ET00518514/20260924
          </p>
          <p className="mt-3 text-[12px] font-extrabold uppercase tracking-kicker text-neutral-700">
            This one doesn&apos;t (film page)
          </p>
          <p className="mt-1 break-all border-2 border-dashed border-divider p-2 text-[13px] text-neutral-700">
            …/movies/kakinada/the-paradise/ET00518274
          </p>
        </section>
      </div>

      <div className="sticky bottom-0 border-t-2 border-divider bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[720px]">
        <button
          type="submit"
          disabled={kind !== "showtimes"}
          className="flex min-h-[54px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white transition-transform duration-75 active:scale-[.98] disabled:opacity-45"
        >
          <span>Continue</span>
          <ArrowRight size={20} strokeWidth={2.5} />
        </button>
        </div>
      </div>
    </form>
  );
}
