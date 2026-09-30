import { Smartphone } from "lucide-react";

/**
 * What a signed-out screen must say to someone who already has an account.
 *
 * "You need an invite link" is wrong for them and sends them to ask for one
 * they cannot use — invites are single-use and theirs is already spent. They
 * are not locked out; this browser simply has no session.
 *
 * It deliberately does NOT link to /devices/new: that page requires a session,
 * so from here it bounces straight back. Pairing starts on the device that is
 * already signed in, and the instructions have to live where they can be read.
 */
export function AlreadyAMember() {
  return (
    <section className="mt-6 border-2 border-divider p-4">
      <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
        <Smartphone size={14} strokeWidth={2.5} />
        Already joined?
      </span>
      <h2 className="mt-1.5 text-xl font-extrabold tracking-tight1">
        You&apos;re just signed out on this browser.
      </h2>
      <p className="mt-2 text-[15px] leading-[1.5] text-neutral-800">
        Your account is fine — this browser has never been paired. Don&apos;t ask for another
        invite; they work once and yours is already used.
      </p>
      <ol className="mt-3 space-y-1.5 text-[15px] text-neutral-800">
        <li><strong>1.</strong> Open Drop Watcher on the phone you normally use</li>
        <li><strong>2.</strong> Tap <strong>Add a device</strong></li>
        <li><strong>3.</strong> Scan the code with this device, or copy the link to it</li>
      </ol>
      <p className="mt-3 text-[13px] text-neutral-700">
        The code lasts ten minutes and signs this browser in as you.
      </p>
    </section>
  );
}
