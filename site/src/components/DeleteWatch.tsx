"use client";

import { useState } from "react";
import { Trash } from "lucide-react";

/**
 * Deleting your own watch.
 *
 * Confirmation is inline and light, not a modal. It is reversible by simply
 * adding the watch back, so the dialog's job is not to frighten anybody — it
 * is to say the one thing people actually worry about: that deleting yours
 * does not take your friends' watches with it.
 */
export function DeleteWatch({
  action, dateLabel, friendNames,
}: { action: () => void; dateLabel: string; friendNames: string }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-6 flex min-h-[44px] items-center gap-2 text-[15px] font-extrabold text-accent-700"
      >
        <Trash size={18} strokeWidth={2.5} />
        Delete this watch
      </button>
    );
  }

  return (
    <div className="mt-6 border-2 border-ink p-4">
      <h2 className="text-lg font-extrabold tracking-tight1">
        Delete your watch for {dateLabel}?
      </h2>
      <p className="mt-2 text-[15px] leading-[1.45] text-neutral-800">
        {friendNames
          ? `Only yours goes. ${friendNames} keep watching and still get their alerts. `
          : "Only yours goes. "}
        You can add it back any time.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <form action={action}>
          <button
            type="submit"
            className="flex min-h-[48px] w-full items-center justify-center bg-accent-600 px-3 text-[15px] font-extrabold text-white"
          >
            Delete mine
          </button>
        </form>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="flex min-h-[48px] w-full items-center justify-center border-2 border-divider px-3 text-[15px] font-extrabold"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
