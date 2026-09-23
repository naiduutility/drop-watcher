import { ArrowUpRight, Eye, EyeOff } from "lucide-react";

/**
 * The first thing on the home screen, above every card.
 *
 * It exists to answer one question before it is asked: "it's quiet — is that
 * good or bad?" On 2026-09-22 someone spent forty minutes unable to tell, and
 * the tickets went. So the healthy state says the quiet is real, and the blind
 * state says our silence means nothing at all until it clears.
 */
export function HealthBanner({
  blind, minutes, lastCleanRead,
}: { blind: boolean; minutes: number | null; lastCleanRead: string }) {
  if (!blind) {
    return (
      <section className="flex items-start gap-3.5 bg-surface p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-divider">
          <Eye size={20} strokeWidth={2.5} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            BookMyShow · reading fine
          </span>
          <h2 className="text-[22px] font-extrabold leading-[1.15] tracking-tight1">
            We can see clearly. If it&apos;s quiet, it&apos;s genuinely quiet.
          </h2>
          <p className="text-sm text-neutral-800">Last clean read {lastCleanRead}</p>
        </div>
      </section>
    );
  }

  return (
    <section role="alert" className="bg-hazard-bg text-hazard-fg">
      <div
        className="h-3"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, var(--color-accent) 0 8px, #201e1d 8px 16px)",
        }}
      />
      <div className="flex flex-col gap-3 p-4">
        <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-kicker text-accent-400">
          <EyeOff size={16} strokeWidth={2.5} />
          BookMyShow is blocking us
        </span>
        <h2 className="text-[32px] font-extrabold leading-[.98] tracking-tight2">
          We&apos;re blind right now.
        </h2>
        <p className="text-[15px] leading-[1.5]">
          No clean read for {minutes ?? "?"} minutes. Silence from us means nothing until this
          clears. This is us failing, not a quiet box office.
        </p>
        <a
          href="https://in.bookmyshow.com"
          className="flex min-h-[52px] items-center justify-between border-2 border-[#f3f2f2] px-4 text-base font-extrabold text-hazard-fg no-underline hover:bg-[#f3f2f2]/10"
        >
          <span>Check BookMyShow yourself</span>
          <ArrowUpRight size={20} strokeWidth={2.5} />
        </a>
        <p className="text-[13px] text-[#f3f2f2]/70">
          We retry every few minutes. This goes away on the first clean read.
        </p>
      </div>
    </section>
  );
}
