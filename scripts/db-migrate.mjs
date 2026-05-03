// Unified Drizzle migration applier.
//
// Reads the journal at drizzle/migrations/meta/_journal.json, queries the
// drizzle.__drizzle_migrations table on the target DB, and applies any
// migrations that aren't already recorded.
//
// Replaces the per-migration scripts/apply-*.mjs files. Idempotent —
// re-running once everything is applied is a no-op.
//
// Usage:
//   node scripts/db-migrate.mjs            # apply pending migrations
//   node scripts/db-migrate.mjs --status   # report what's pending, no writes
//
// DATABASE_URL must be set (.env.local locally, GitHub secret in CI).

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import pg from "pg";

config({ path: ".env.local" });

const STATUS_ONLY = process.argv.includes("--status");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Put it in .env.local for local runs, " +
      "or add it as a GitHub Actions secret for CI."
  );
  process.exit(1);
}

const host =
  process.env.DATABASE_URL.split("@")[1]?.split("/")[0] ?? "(unknown host)";
console.log(`Target: ${host}`);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function readPending() {
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/migrations/meta/_journal.json", import.meta.url),
      "utf-8"
    )
  );

  const result = await pool.query(
    `SELECT hash FROM drizzle.__drizzle_migrations`
  );
  const appliedCount = result.rowCount;

  const journalCount = journal.entries.length;
  const pending = Math.max(0, journalCount - appliedCount);

  return { appliedCount, journalCount, pending, lastTag: journal.entries.at(-1)?.tag };
}

try {
  const pre = await readPending();
  console.log(
    `Journal: ${pre.journalCount} entries (last: ${pre.lastTag}). ` +
      `Applied: ${pre.appliedCount}. Pending: ${pre.pending}.`
  );

  if (STATUS_ONLY) {
    console.log(
      pre.pending === 0
        ? "Status only — nothing to apply."
        : `Status only — ${pre.pending} migration(s) would be applied. Run without --status to apply.`
    );
    await pool.end();
    process.exit(0);
  }

  if (pre.pending === 0) {
    console.log("Up to date. Nothing to apply.");
    await pool.end();
    process.exit(0);
  }

  const db = drizzle(pool);
  console.log(`Applying ${pre.pending} migration(s)...`);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });

  const post = await readPending();
  console.log(
    `Done. Applied: ${post.appliedCount}/${post.journalCount}.`
  );
  await pool.end();
} catch (err) {
  console.error("Migration failed:", err.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
