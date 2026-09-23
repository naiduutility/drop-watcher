import { ArrowUpRight, EyeOff } from "lucide-react";

import type { PickStatus } from "../lib/narrowing.js";

/**
 * "It's on sale here — just not in the room you asked for."
 *
 * Deliberately loud. A narrowed watch that stays quiet while the film is
 * bookable at the cinema it names is the same unexplained silence this project
 * exists to remove; the only difference is that this time we caused it on
 * purpose, at the person's request. So we say it, say what IS running, and
 * offer the one-tap way out.
 *
 * Not an alert, though. They asked for that screen specifically, and a
 * notification saying "not the one you wanted" every five minutes would be
 * the noise that gets the whole app muted.
 */
export function NotYourScreen({
  misses, bookUrl, widen,
}: {
  misses: PickStatus[];
  bookUrl: string;
  widen: (code: string) => void;
}) {
  if (misses.length === 0) return null;

  return (
    <section className="mb-7 border-2 border-ink">
      <div className="flex items-center gap-2 bg-ink px-4 py-2 text-bg">
        <EyeOff size={16} strokeWidth={2.5} />
        <span className="text-[11px] font-extrabold uppercase tracking-kicker">
          On sale — but not your screen
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="text-[15px] leading-[1.45]">
          This date is bookable, and you won&apos;t hear from us, because the screens you picked
          aren&apos;t the ones running it.
        </p>
        <ul className="mt-3">
          {misses.map((m) => (
            <li key={m.code} className="border-t border-divider py-3">
              <span className="block text-[15px] font-extrabold">{m.name}</span>
              <span className="mt-0.5 block text-[14px] text-neutral-700">
                You asked for{" "}
                <strong className="text-ink">
                  {m.kind === "wrong_screen" ? m.wanted.join(", ") : ""}
                </strong>
                . It&apos;s running{" "}
                <strong className="text-ink">
                  {m.kind === "wrong_screen" ? (m.running.join(", ") || "something else") : ""}
                </strong>
                .
              </span>
              <form action={() => widen(m.code)}>
                <button
                  type="submit"
                  className="mt-2 flex min-h-[44px] w-full items-center justify-between border-2 border-divider px-3.5 text-[15px] font-extrabold"
                >
                  <span>Watch any screen at {m.name.split(":")[0]!.trim()}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <a
          href={bookUrl}
          className="mt-2 flex min-h-[48px] items-center justify-between bg-accent-600 px-4 text-[15px] font-extrabold text-white no-underline"
        >
          <span>See it on BookMyShow</span>
          <ArrowUpRight size={18} strokeWidth={2.5} />
        </a>
      </div>
    </section>
  );
}
