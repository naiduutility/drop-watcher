import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { Ticket, Unlink } from "lucide-react";

import { db } from "../../../db/index.js";
import { channels, invites, users } from "../../../db/schema.js";
import { setSessionCookie } from "../../../lib/auth.js";
import {
  SESSION_TTL_MS, randomTopic, sessionSecret, signSession,
} from "../../../lib/session.js";
import { AppHeader } from "../../../components/AppHeader.js";
import { JoinForm } from "../../../components/JoinForm.js";

export const dynamic = "force-dynamic";

const DEAD = {
  claimed: {
    kicker: "Already used",
    title: "Someone's already joined with this invite.",
    why: "Invites work once, and this one has been claimed.",
  },
  expired: {
    kicker: "Expired",
    title: "This invite ran out of time.",
    why: "Invites only stay open for a while, and this one closed.",
  },
  invalid: {
    kicker: "Not a real link",
    title: "We don't recognise this invite.",
    why: "The link may have been cut short when it was copied.",
  },
} as const;

function Dead({ kind }: { kind: keyof typeof DEAD }) {
  const copy = DEAD[kind];
  const wa = `https://wa.me/?text=${encodeURIComponent(
    "My Drop Watcher invite link didn't work — could you send me a fresh one?",
  )}`;
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[640px] flex-col px-4 pb-4 pt-10">
        <div className="flex-1">
          <div className="flex h-16 w-16 items-center justify-center border-2 border-divider">
            <Unlink size={28} strokeWidth={2.5} />
          </div>
          <span className="mt-5 block text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            {copy.kicker}
          </span>
          <h1 className="mt-1.5 text-[38px] font-extrabold leading-[.98] tracking-tight2">
            {copy.title}
          </h1>
          <p className="mt-3 text-[17px] leading-[1.5] text-neutral-800">{copy.why}</p>
          <p className="mt-3 text-[17px] leading-[1.5] text-neutral-800">
            Ask whoever sent it for a fresh one. It takes them ten seconds.
          </p>
        </div>
        <div className="sticky bottom-0 bg-bg pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
          <a
            href={wa}
            className="flex min-h-[54px] items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white no-underline"
          >
            <span>Ask for a new link on WhatsApp</span>
          </a>
        </div>
      </main>
    </>
  );
}

export default async function Join({ params }: { params: { token: string } }) {
  async function claim(form: FormData) {
    "use server";
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!name || !email.includes("@")) return;

    const created = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(invites)
        .where(eq(invites.token, params.token)).limit(1);
      if (!invite || invite.claimedBy || invite.expiresAt.getTime() < Date.now()) return null;

      const [user] = await tx.insert(users).values({ email, displayName: name }).returning();
      if (!user) return null;

      // Conditional on still being unclaimed: this is what makes the invite
      // single-use even when two people open the link at once.
      const won = await tx.update(invites)
        .set({ claimedBy: user.id, claimedAt: new Date() })
        .where(and(eq(invites.token, params.token), isNull(invites.claimedBy)))
        .returning();
      if (won.length === 0) throw new Error("claimed concurrently");

      await tx.insert(channels).values({
        userId: user.id, kind: "ntfy", config: { topic: randomTopic() },
      });
      return user;
    }).catch(() => null);

    if (!created) return;
    setSessionCookie(
      signSession(created.id, Date.now() + SESSION_TTL_MS, sessionSecret()),
      SESSION_TTL_MS,
    );
    redirect("/");
  }

  const [invite] = await db.select().from(invites)
    .where(eq(invites.token, params.token)).limit(1);

  if (!invite) return <Dead kind="invalid" />;
  if (invite.claimedBy) return <Dead kind="claimed" />;
  if (invite.expiresAt.getTime() < Date.now()) return <Dead kind="expired" />;

  return (
    <>
      <AppHeader />
      <section className="bg-accent-600 text-white">
        <div className="mx-auto max-w-[640px] px-4 pb-7 pt-8">
          <span className="flex h-12 w-12 items-center justify-center bg-white">
            <Ticket size={24} strokeWidth={2.5} className="text-accent-600" />
          </span>
          <span className="mt-5 block text-[11px] font-extrabold uppercase tracking-kicker">
            You&apos;re invited
          </span>
          <h1 className="mt-1.5 text-[44px] font-extrabold leading-[.94] tracking-display">
            Know the minute tickets drop.
          </h1>
          <p className="mt-3 text-[16px] leading-[1.45]">
            We watch BookMyShow so you don&apos;t have to — including the premiere date that
            isn&apos;t listed yet.
          </p>
        </div>
      </section>
      <JoinForm action={claim} />
    </>
  );
}
