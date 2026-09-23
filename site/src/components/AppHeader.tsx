import Link from "next/link";
import { ArrowLeft, Smartphone, Ticket } from "lucide-react";

/** Sticky, 2px bottom rule, brand mark left. Back link replaces the brand on
 *  inner screens so the title is never competing with it for the same space. */
export function AppHeader({
  back, title, initial, devices = false, right,
}: {
  back?: { href: string; label: string };
  title?: string;
  initial?: string;
  devices?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-divider bg-bg">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 px-4">
        {back ? (
          <Link href={back.href} className="flex items-center gap-2 text-[15px] font-extrabold text-ink no-underline">
            <ArrowLeft size={18} strokeWidth={2.5} />
            <span>{back.label}</span>
          </Link>
        ) : (
          <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
            <span className="flex h-[26px] w-[26px] items-center justify-center bg-accent">
              <Ticket size={16} strokeWidth={2.5} className="text-white" />
            </span>
            <span className="text-[17px] font-extrabold tracking-tight1">Drop Watcher</span>
          </Link>
        )}
        {title ? <span className="text-[15px] font-extrabold">{title}</span> : null}
        <div className="flex items-center gap-2">
          {right}
          {devices ? (
            <Link
              href="/devices/new"
              aria-label="Add a device"
              className="flex h-11 w-11 items-center justify-center text-ink no-underline"
            >
              <Smartphone size={20} strokeWidth={2.5} />
            </Link>
          ) : null}
          {initial ? (
            <span className="flex h-8 w-8 items-center justify-center bg-ink text-sm font-extrabold text-bg">
              {initial.toUpperCase()}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
