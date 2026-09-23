/**
 * Database connection.
 *
 * postgres.js over TCP rather than the Neon HTTP driver, because the worker
 * needs real transactions — the due queue claims rows with FOR UPDATE SKIP
 * LOCKED so two workers (Actions and a laptop) never scrape the same target
 * twice at an IP that is already being rate limited.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Create a free Postgres database (Neon), then " +
    "put its connection string in site/.env.local or the DATABASE_URL secret.",
  );
}

// Neon's pooled endpoint runs PgBouncer in TRANSACTION mode, where a prepared
// statement created on one backend is invisible to the next — postgres.js
// prepares by default, so this fails intermittently and confusingly under
// load. Detected from the host rather than configured, because the web app on
// serverless will want the pooled endpoint while the worker may not, and
// neither should have to remember.
const pooled = url.includes("-pooler.");

// max: 1 — a cron worker makes one short pass and exits; a pool would just
// hold connections open against a free-tier limit for no benefit.
const client = postgres(url, {
  max: Number(process.env.DB_POOL ?? 1),
  prepare: !pooled,
});

export const db = drizzle(client, { schema });
export { schema };
