import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../../db/index.js";
import { channels, invites, users } from "../../../db/schema.js";
import { setSessionCookie } from "../../../lib/auth.js";
import {
  SESSION_TTL_MS, randomTopic, sessionSecret, signSession,
} from "../../../lib/session.js";

export const dynamic = "force-dynamic";

/**
 * Claiming an invite.
 *
 * The claim and the account creation happen in ONE transaction, and the update
 * is conditional on the invite still being unclaimed. Two people opening the
 * same link race for a single row update: one wins, the other is told the
 * invite is spent. Checking first and inserting after would let both through.
 */
async function claim(token: string, email: string) {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select().from(invites).where(eq(invites.token, token)).limit(1);
    if (!invite) return { error: "That invite link is not valid." };
    if (invite.claimedBy) return { error: "That invite has already been used." };
    if (invite.expiresAt.getTime() < Date.now()) return { error: "That invite has expired." };

    const [user] = await tx.insert(users).values({ email, displayName: null }).returning();
    if (!user) return { error: "Could not create the account." };

    // Conditional on still being unclaimed: this is the line that makes the
    // invite single-use even under a race.
    const won = await tx
      .update(invites)
      .set({ claimedBy: user.id, claimedAt: new Date() })
      .where(and(eq(invites.token, token), isNull(invites.claimedBy)))
      .returning();
    if (won.length === 0) {
      throw new Error("invite claimed concurrently");
    }

    await tx.insert(channels).values({
      userId: user.id, kind: "ntfy", config: { topic: randomTopic() },
    });
    return { user };
  });
}

export default async function Join({ params }: { params: { token: string } }) {
  async function submit(form: FormData) {
    "use server";
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) return;
    let result;
    try {
      result = await claim(params.token, email);
    } catch {
      return; // lost the race; the page will show the invite as spent
    }
    if ("user" in result && result.user) {
      const expiresAt = Date.now() + SESSION_TTL_MS;
      setSessionCookie(signSession(result.user.id, expiresAt, sessionSecret()), SESSION_TTL_MS);
      redirect("/");
    }
  }

  const [invite] = await db
    .select().from(invites).where(eq(invites.token, params.token)).limit(1);

  if (!invite || invite.claimedBy || invite.expiresAt.getTime() < Date.now()) {
    return (
      <>
        <h1>Invite not usable</h1>
        <p className="muted">
          {!invite ? "This link is not valid."
            : invite.claimedBy ? "This invite has already been claimed. Invites work once."
            : "This invite has expired."}
        </p>
        <p>Ask whoever sent it for a fresh one.</p>
      </>
    );
  }

  return (
    <>
      <h1>Join Drop Watcher</h1>
      <p className="muted">
        This invite works once. Your email is only used to tell accounts apart.
      </p>
      <form action={submit}>
        <p><input type="email" name="email" placeholder="you@example.com" required /></p>
        <button type="submit">Claim invite</button>
      </form>
    </>
  );
}
