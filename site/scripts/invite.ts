/**
 * Mint a single-use invite.
 *
 * There is no admin UI yet, and the first invite has a chicken-and-egg problem
 * anyway: nobody exists to issue it. `createdBy` is therefore nullable, and a
 * bootstrap invite is simply one nobody issued.
 *
 *   npm run invite              -- 7 days
 *   npm run invite -- 2         -- 2 days
 *
 * Prints a join URL. Treat it like a password: anyone holding it becomes a
 * member, once.
 */

import { invites } from "../src/db/schema.js";
import { db } from "../src/db/index.js";
import { randomInviteToken } from "../src/lib/session.js";

const days = Number(process.argv[2] ?? 7);
if (!Number.isFinite(days) || days <= 0 || days > 90) {
  console.error("Usage: npm run invite -- <days, 1-90>");
  process.exit(2);
}

const token = randomInviteToken();
const expiresAt = new Date(Date.now() + days * 86_400_000);
await db.insert(invites).values({ token, expiresAt });

const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
console.log(`\nInvite created, valid for ${days} day(s), usable once.\n`);
console.log(`  ${base}/join/${token}\n`);
console.log("Send it over something private. It stops working the moment it is claimed.\n");
process.exit(0);
