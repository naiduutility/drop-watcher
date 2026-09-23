import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { Lock, Plus } from "lucide-react";

import { db } from "../../../db/index.js";
import { invites, users } from "../../../db/schema.js";
import { currentUser } from "../../../lib/auth.js";
import { randomInviteToken } from "../../../lib/session.js";
import { AppHeader } from "../../../components/AppHeader.js";
import { InviteRow } from "../../../components/InviteRow.js";

export const dynamic = "force-dynamic";

/**
 * The invite link's origin.
 *
 * Read from the request rather than an env var, so the link always points at
 * the host the owner is actually looking at. A link built from a stale
 * APP_URL would be handed to a friend and simply not work.
 */
function origin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const VALIDITY = [
  { label: "1 hour", hours: 1 },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
];

function when(d: Date): string {
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function AdminInvites() {
  const me = await currentUser();
  // Not "403", not a redirect: this screen does not exist for anyone else, and
  // nothing in the app links to it.
  if (!me?.isOwner) notFound();

  async function create(form: FormData) {
    "use server";
    const owner = await currentUser();
    // Re-checked inside the action, not just on render: a server action is a
    // public endpoint, and rendering the page is not what authorises the write.
    if (!owner || !owner.isOwner) notFound();
    const hours = Number(form.get("hours") ?? 24);
    const valid = VALIDITY.some((v) => v.hours === hours) ? hours : 24;
    await db.insert(invites).values({
      token: randomInviteToken(),
      createdBy: owner.id,
      expiresAt: new Date(Date.now() + valid * 3_600_000),
    });
    revalidatePath("/admin/invites");
  }

  const rows = await db
    .select({ invite: invites, claimer: users })
    .from(invites)
    .leftJoin(users, eq(invites.claimedBy, users.id))
    .orderBy(desc(invites.createdAt));

  const now = new Date();
  const base = origin();
  const unclaimed = rows.filter((r) => !r.invite.claimedBy && r.invite.expiresAt > now);
  const claimed = rows.filter((r) => r.invite.claimedBy);
  const expired = rows.filter((r) => !r.invite.claimedBy && r.invite.expiresAt <= now);

  return (
    <>
      <AppHeader
        back={{ href: "/", label: "Your watches" }}
        right={
          <span className="flex items-center gap-1.5 border border-divider px-2 py-1 text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
            <Lock size={12} strokeWidth={2.5} />
            Owner only
          </span>
        }
      />

      <main className="mx-auto max-w-[720px] px-4 pb-20 pt-5">
        <h1 className="text-[28px] font-extrabold leading-none tracking-tight2">Invites</h1>

        <section className="mt-5 bg-surface p-4">
          <h2 className="text-xl font-extrabold tracking-tight1">New invite</h2>
          <p className="mt-2 text-[15px] text-neutral-800">
            The link doesn&apos;t carry a name. Whoever opens it first types their own name and
            email, and the link dies the moment they do.
          </p>
          <form action={create} className="mt-4">
            <span className="text-[11px] font-extrabold uppercase tracking-kicker text-neutral-700">
              Valid for
            </span>
            <div className="mt-2 grid grid-cols-3 border-2 border-ink">
              {VALIDITY.map((v, i) => (
                <label
                  key={v.hours}
                  className={`relative flex min-h-[48px] cursor-pointer items-center justify-center text-[15px] font-extrabold ${
                    i > 0 ? "border-l-2 border-ink" : ""
                  } has-[:checked]:bg-ink has-[:checked]:text-bg`}
                >
                  <input
                    type="radio"
                    name="hours"
                    value={v.hours}
                    defaultChecked={v.hours === 24}
                    className="sr-only"
                  />
                  {v.label}
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="mt-3 flex min-h-[54px] w-full items-center justify-between bg-accent-600 px-4 text-[17px] font-extrabold text-white transition-transform duration-75 active:scale-[.98]"
            >
              <span>Create invite link</span>
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </form>
        </section>

        <h2 className="mt-8 border-b-2 border-ink pb-2 text-xl font-extrabold tracking-tight1">
          Unclaimed
          <span className="ml-2 text-[13px] font-semibold text-neutral-700">
            {unclaimed.length} · each works once
          </span>
        </h2>
        {unclaimed.length === 0 ? (
          <p className="py-4 text-[15px] text-neutral-700">
            None open. Create one above when you want to add somebody.
          </p>
        ) : (
          <ul className="mb-2">
            {unclaimed.map(({ invite }) => (
              <InviteRow
                key={invite.token}
                url={`${base}/join/${invite.token}`}
                made={when(invite.createdAt)}
                expires={when(invite.expiresAt)}
              />
            ))}
          </ul>
        )}

        {claimed.length > 0 ? (
          <>
            <h2 className="mt-8 border-b-2 border-ink pb-2 text-xl font-extrabold tracking-tight1">
              Claimed
              <span className="ml-2 text-[13px] font-semibold text-neutral-700">link is dead</span>
            </h2>
            <ul>
              {claimed.map(({ invite, claimer }) => (
                <li key={invite.token} className="flex items-center gap-3 border-t border-divider py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-ink text-sm font-extrabold text-bg">
                    {(claimer?.displayName ?? claimer?.email ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold">
                      {claimer?.displayName ?? "—"}
                    </span>
                    <span className="block truncate text-[13px] text-neutral-700">{claimer?.email}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-neutral-700">
                    {invite.claimedAt ? when(invite.claimedAt) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {expired.length > 0 ? (
          <>
            <h2 className="mt-8 border-b-2 border-ink pb-2 text-xl font-extrabold tracking-tight1">
              Expired
              <span className="ml-2 text-[13px] font-semibold text-neutral-700">never opened</span>
            </h2>
            <ul>
              {expired.map(({ invite }) => (
                <li key={invite.token} className="flex items-center justify-between gap-3 border-t border-divider py-3 text-neutral-600">
                  <span className="min-w-0 truncate text-[15px] line-through">
                    {base.replace(/^https?:\/\//, "")}/join/••••••••{invite.token.slice(-4)}
                  </span>
                  <span className="shrink-0 text-[13px]">expired {when(invite.expiresAt)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </>
  );
}
