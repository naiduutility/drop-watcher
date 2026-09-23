/**
 * Keeping the per-city cinema catalogue up to date.
 *
 * Called after every successful read, with the venues that read returned. No
 * request is made here — the data was already in a payload we fetched for
 * another reason, which is what makes maintaining this free.
 */

import { sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { venues } from "../db/schema.js";
import type { Venue } from "../engine/index.js";

/**
 * Record every venue seen in one reading.
 *
 * `screens` accumulates rather than replaces: BMS reports the formats a venue
 * is running THIS movie on, so replacing would make a cinema's IMAX vanish the
 * moment the watched film moved to a 2D screen. The union is computed in SQL so
 * this stays one statement however many venues came back.
 *
 * A venue whose screens could not be read arrives as null and is stored with
 * an empty list, which the union then leaves alone until some later read
 * actually reports formats. So "we could not read the screens" degrades to
 * "no formats seen here yet" — never to a positive claim that the venue lacks
 * the screen someone is waiting for.
 */
export async function rememberVenues(city: string, seen: Venue[]): Promise<number> {
  const rows = seen
    .filter((v) => v.code && v.name)
    .map((v) => ({
      city,
      code: v.code,
      name: v.name,
      screens: v.screens ?? [],
    }));
  if (rows.length === 0) return 0;

  await db
    .insert(venues)
    .values(rows)
    .onConflictDoUpdate({
      target: [venues.city, venues.code],
      set: {
        // The newest name wins: a rename should follow BMS, not fossilise.
        name: sql`excluded.name`,
        screens: sql`(
          select coalesce(array_agg(distinct s), '{}')
          from unnest(${venues.screens} || excluded.screens) as s
        )`,
        lastSeenAt: sql`now()`,
      },
    });
  return rows.length;
}
