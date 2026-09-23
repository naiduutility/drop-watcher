"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copy-to-clipboard that confirms itself.
 *
 * The label swaps to "Copied" and the fill flips, then reverts after 1.8s.
 * Without that confirmation people tap twice and then go looking for what they
 * broke — and this is the control that hands over a notification topic, which
 * someone who mis-copies simply never receives alerts on.
 */
export function CopyField({
  value, label = "Copy", big = false,
}: { value: string; label?: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Denied clipboard permission: say nothing rather than lie.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`flex ${big ? "border-2 border-ink" : "border border-divider"}`}>
      <span
        className={`flex min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap px-3 ${
          big ? "py-3 text-[17px] font-extrabold" : "py-2 text-[15px] font-semibold"
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className={`flex shrink-0 items-center gap-2 px-4 text-[15px] font-extrabold transition-colors duration-150 ${
          copied ? "bg-ink text-bg" : "bg-accent-600 text-white"
        }`}
      >
        {copied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2.5} />}
        <span>{copied ? "Copied" : label}</span>
      </button>
    </div>
  );
}
