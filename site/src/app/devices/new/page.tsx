import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { db } from "../../../db/index.js";
import { deviceLinks } from "../../../db/schema.js";
import { currentUser } from "../../../lib/auth.js";
import { randomInviteToken } from "../../../lib/session.js";
import { AppHeader } from "../../../components/AppHeader.js";
import { DevicePairing } from "../../../components/DevicePairing.js";

export const dynamic = "force-dynamic";

/** Ten minutes. Long enough to walk to a laptop, short enough that a link left
 *  in a chat thread is useless by the time anyone else finds it. */
const PAIRING_MS = 10 * 60_000;

function origin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function NewDevice() {
  const user = await currentUser();
  if (!user) redirect("/");

  // A fresh code per visit. Reloading the page is how you get a new one after
  // the old expires, which is what the expiry copy tells people to do.
  const code = randomInviteToken();
  const expiresAt = new Date(Date.now() + PAIRING_MS);
  await db.insert(deviceLinks).values({ code, userId: user.id, expiresAt });

  const url = `${origin()}/p/${code}`;
  // Rendered server-side: no QR library ships to the browser, and the image is
  // there in the first paint rather than after hydration.
  const qr = await QRCode.toDataURL(url, {
    margin: 1,
    width: 640,
    color: { dark: "#201e1d", light: "#ffffff" },
  });

  return (
    <>
      <AppHeader back={{ href: "/", label: "Your watches" }} title="Add a device" />
      <main className="mx-auto max-w-[560px] px-4 pb-16 pt-5">
        <h1 className="mb-3 text-[28px] font-extrabold leading-none tracking-tight2">
          Add a device
        </h1>
        <DevicePairing qr={qr} url={url} expiresAt={expiresAt.toISOString()} totalMs={PAIRING_MS} />
      </main>
    </>
  );
}
