import { readFileSync } from "node:fs";

import type { Config } from "drizzle-kit";

// Load .env.local ourselves: drizzle-kit reads .env, but the connection string
// lives in .env.local (gitignored, and the repo is public). Six lines beats a
// dependency, and it means `npm run db:push` works with no extra flags.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq < 1 || line.trimStart().startsWith("#")) continue;
      const key = line.slice(0, eq).trim();
      if (!process.env[key]) {
        process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local is fine — CI supplies DATABASE_URL as a secret.
  }
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
