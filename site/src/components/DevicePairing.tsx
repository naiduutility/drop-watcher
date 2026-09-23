"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Lock } from "lucide-react";

/**
 * The pairing screen, held up in front of another device.
 *
 * The countdown is not decoration. This link signs somebody in as you, so the
 * person holding the phone needs to see, without reading anything, how long it
 * stays dangerous. At zero the QR fades rather than disappearing, so it is
 * obvious the code expired rather than the page breaking.
 */
export function DevicePairing({
  qr, url, expiresAt, totalMs,
}: { qr: string; url: string; expiresAt: string; totalMs: number }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(
      () => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(t);
  }, [expiresAt]);

  const dead = left <= 0;
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  const urgent = left > 0 && left < 60_000;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <p className="text-[15px] leading-[1.5] text-neutral-800">
        Scan this with the camera on your other phone or laptop. It signs in as you.
      </p>

      <div className={`mt-4 border-2 border-ink bg-white p-4 transition-opacity duration-300 ${dead ? "opacity-15" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Pairing QR code" className="block w-full" />
      </div>

      <div className="mt-4">
        <span
          className={`block text-[56px] font-extrabold leading-[.9] tracking-tight2 tabular-nums ${
            urgent ? "text-accent-700" : ""
          }`}
        >
          {mins}:{String(secs).padStart(2, "0")}
        </span>
        <span className="mt-1 block text-[15px] text-neutral-700">
          {dead ? "expired. Go back and make a new one." : "left before this code stops working"}
        </span>
        <div className="mt-3 h-2 w-full bg-neutral-300">
          <div
            className="h-full bg-accent-600 transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.max(0, Math.min(100, (left / totalMs) * 100))}%` }}
          />
        </div>
      </div>

      <div className="mt-6 border-t-2 border-divider pt-5">
        <h2 className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
          Or send yourself the link
        </h2>
        <div className="mt-2 flex border-2 border-divider">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-3 text-base font-semibold">
            {url}
          </span>
          <button
            type="button"
            onClick={copy}
            className={`flex shrink-0 items-center gap-2 px-4 text-[15px] font-extrabold transition-colors duration-150 ${
              copied ? "bg-ink text-bg" : "bg-accent-600 text-white"
            }`}
          >
            {copied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2.5} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[14px] leading-[1.45] text-accent-700">
          <Lock size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" />
          <span>
            Anyone who opens this within 10 minutes signs in as you. Send it only to yourself.
          </span>
        </p>
      </div>
    </>
  );
}
