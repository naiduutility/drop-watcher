import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { Clock, LogIn } from "lucide-react";

import { db } from "../../../db/index.js";
import { deviceLinks, users } from "../../../db/schema.js";
import { setSessionCookie } from "../../../lib/auth.js";
import { SESSION_TTL_MS, sessionSecret, signSession } from "../../../lib/session.js";
import { AppHeader } from "../../../components/AppHeader.js";

export const dynamic = "force-dynamic";

function Dead({ title, why }: { title: string; why: string }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[560px] px-4 pb-16 pt-10">
        <div className="flex h-16 w-16 items-center justify-center border-2 border-divider">
          <Clock size={28} strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-[44px] font-extrabold leading-[.96] tracking-tight2">{title}</h1>
        <p className="mt-3 text-[17px] leading-[1.5] text-neutral-800">{why}</p>
        <p className="mt-5 border-t-2 border-divider pt-4 text-[15px] text-neutral-700">
          On a phone that&apos;s already signed in, open <strong>Add a device</strong> for a fresh
          one.
        </p>
      </main>
    </>
  );
}

export default async function Pair({ params }: { params: { code: string } }) {
  const [link] = await db
    .select({ link: deviceLinks, user: users })
    .from(deviceLinks)
    .innerJoin(users, eq(deviceLinks.userId, users.id))
    .where(eq(deviceLinks.code, params.code))
    .limit(1);

  if (!link) {
    return <Dead title="This link isn't valid." why="We don't recognise this pairing code." />;
  }
  if (link.link.usedAt) {
    return (
      <Dead
        title="This link has already been used."
        why="Pairing codes work once, and this one has been claimed."
      />
    );
  }
  if (link.link.expiresAt.getTime() < Date.now()) {
    return (
      <Dead
        title="This link has expired."
        why="Pairing codes only last ten minutes, so a link left lying around can't be used later."
      />
    );
  }

  const who = link.user.displayName ?? link.user.email;

  /**
   * Redeeming is a POST behind a button, never a GET.
   *
   * A link that signed you in merely by being fetched would be consumed by a
   * browser prefetch, a chat app's link preview, or an antivirus scanner —
   * spending the code before the person ever saw the page.
   */
  async function confirm() {
    "use server";
    // Conditional on still being unused, so two devices opening the same code
    // race for one row update instead of both getting a session.
    const won = await db
      .update(deviceLinks)
      .set({ usedAt: new Date() })
      .where(and(eq(deviceLinks.code, params.code), isNull(deviceLinks.usedAt)))
      .returning();
    if (won.length === 0 || !won[0]) return;
    if (won[0].expiresAt.getTime() < Date.now()) return;

    const expires = Date.now() + SESSION_TTL_MS;
    setSessionCookie(signSession(won[0].userId, expires, sessionSecret()), SESSION_TTL_MS);
    redirect("/");
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[560px] flex-col px-4 pb-4 pt-10">
        <div className="flex-1">
          <span className="flex h-[72px] w-[72px] items-center justify-center bg-ink text-[30px] font-extrabold text-bg">
            {who.charAt(0).toUpperCase()}
          </span>
          <h1 className="mt-5 text-[52px] font-extrabold leading-[.92] tracking-display">
            Sign in as {who}?
          </h1>
          <p className="mt-4 text-[17px] leading-[1.5] text-neutral-800">
            This link came from {who}&apos;s signed-in phone. Continue only if you&apos;re {who}.
            You&apos;ll see their watches and can silence their alerts.
          </p>
        </div>

        <div className="sticky bottom-0 bg-bg pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
          <form action={confirm}>
            <button
              type="submit"
              className="flex min-h-[58px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white transition-transform duration-75 active:scale-[.98]"
            >
              <span>Yes, sign me in</span>
              <LogIn size={20} strokeWidth={2.5} />
            </button>
          </form>
          <Link
            href="/"
            className="mt-2 flex min-h-[44px] items-center justify-center text-[15px] font-extrabold text-neutral-700 no-underline"
          >
            I&apos;m not {who}
          </Link>
        </div>
      </main>
    </>
  );
}
