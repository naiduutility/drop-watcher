"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, Lock } from "lucide-react";

/**
 * Claiming an invite.
 *
 * The name is asked for first and previewed live, because it is the one field
 * whose consequence is visible to other people — it appears on their screens as
 * "{name} is watching this too". Showing that sentence as they type is quicker
 * than explaining it.
 */
export function JoinForm({ action }: { action: (form: FormData) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && email.includes("@");

  return (
    <form action={action} onSubmit={() => setBusy(true)} className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="mx-auto w-full max-w-[640px] flex-1 px-4 pb-6">
        <label className="mt-6 block">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Your name
          </span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            className="mt-2 w-full border-2 border-divider bg-transparent px-3 py-3.5 text-[17px] outline-none"
          />
          <span className="mt-1.5 block text-[13px] text-neutral-700">
            Friends see it: “<strong>{name.trim() || "Ravi"}</strong> is watching this too.”
          </span>
        </label>

        <label className="mt-5 block">
          <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            Email
          </span>
          <input
            name="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-2 w-full border-2 border-divider bg-transparent px-3 py-3.5 text-[17px] outline-none"
          />
          <span className="mt-1.5 block text-[13px] text-neutral-700">
            Only used to tell accounts apart. No password, and we never email you.
          </span>
        </label>

        <p className="mt-6 flex items-start gap-2 border-t-2 border-divider pt-4 text-[14px] text-neutral-700">
          <Lock size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" />
          <span>This invite works once. After you join, it&apos;s gone.</span>
        </p>
      </div>

      <div className="sticky bottom-0 border-t-2 border-divider bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[640px]">
          <button
            type="submit"
            disabled={!ready || busy}
            className="flex min-h-[54px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white transition-transform duration-75 active:scale-[.98] disabled:opacity-45"
          >
            <span>{busy ? "Joining…" : "Join Drop Watcher"}</span>
            {busy
              ? <LoaderCircle size={20} strokeWidth={2.5} className="animate-spin1s" />
              : <ArrowRight size={20} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </form>
  );
}
