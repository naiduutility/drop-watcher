"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Lock, Share2 } from "lucide-react";

/**
 * One unclaimed invite.
 *
 * The link is masked by default. Possession IS the claim — anyone who reads it
 * becomes a member — so it should feel like something handled carefully rather
 * than a URL sitting on screen while you show someone else your phone.
 */
export function InviteRow({
  url, made, expires,
}: { url: string; made: string; expires: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const masked = (() => {
    const tail = url.slice(-4);
    const base = url.replace(/^https?:\/\//, "").split("/join/")[0] ?? "";
    return `${base}/join/••••••••${tail}`;
  })();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function share() {
    const text = `Join me on Drop Watcher — it tells you the minute tickets drop.\n${url}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // Cancelled or unsupported: fall through to WhatsApp.
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  return (
    <li className="border-t border-divider py-3">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <Lock size={16} strokeWidth={2.5} className="shrink-0 text-neutral-700" />
        <span className="min-w-0 flex-1 truncate">{shown ? url : masked}</span>
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide the link" : "Reveal the link"}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-700"
        >
          {shown ? <EyeOff size={18} strokeWidth={2.5} /> : <Eye size={18} strokeWidth={2.5} />}
        </button>
      </div>
      <p className="mt-1 text-[13px] text-neutral-700">Made {made} · expires {expires}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copy}
          className={`flex min-h-[48px] items-center justify-between border-2 px-3.5 text-[15px] font-extrabold transition-colors duration-150 ${
            copied ? "border-ink bg-ink text-bg" : "border-divider text-ink"
          }`}
        >
          <span>{copied ? "Copied" : "Copy link"}</span>
          {copied ? <Check size={18} strokeWidth={2.5} /> : <Copy size={18} strokeWidth={2.5} />}
        </button>
        <button
          type="button"
          onClick={share}
          className="flex min-h-[48px] items-center justify-between bg-accent-600 px-3.5 text-[15px] font-extrabold text-white"
        >
          <span>Share</span>
          <Share2 size={18} strokeWidth={2.5} />
        </button>
      </div>
    </li>
  );
}
