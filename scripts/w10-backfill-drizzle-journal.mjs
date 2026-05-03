// W10 cleanup — backfill drizzle.__drizzle_migrations for migrations
// 0003–0011 that were applied via raw scripts/apply-*.mjs (bypassing
// drizzle-kit). Without this, a future `drizzle-kit migrate` run would
// try to re-apply them. Most are CREATE OR REPLACE so they'd succeed,
// but the seed INSERTs and rebuilt RPCs would churn unnecessarily.
//
// Drizzle's migrator schema:
//   drizzle.__drizzle_migrations (id SERIAL, hash text, created_at bigint)
// where hash = sha256(migration sql), created_at = the `when` from
// drizzle/migrations/meta/_journal.json.

import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/migrations/meta/_journal.json", import.meta.url),
    "utf-8"
  )
);

const migDir = new URL("../drizzle/migrations/", import.meta.url);
const allFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();

// Existing entries in DB
const existing = await c.query(
  `SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`
);
const existingHashes = new Set(existing.rows.map((r) => r.hash));
console.log(`drizzle.__drizzle_migrations currently has ${existing.rowCount} rows`);

let backfilled = 0;
for (const entry of journal.entries) {
  // Find the matching file (Drizzle's filename is `<idx>_<tag>.sql` but
  // some of ours don't include the idx prefix — we keyed by tag in the
  // journal). Match on the tag substring.
  const matchFile = allFiles.find((f) => f.replace(/\.sql$/, "") === entry.tag);
  if (!matchFile) {
    console.warn(`  ⚠️  no SQL file for journal entry ${entry.tag} — skipping`);
    continue;
  }
  const sql = readFileSync(new URL(matchFile, migDir), "utf-8");
  const hash = createHash("sha256").update(sql).digest("hex");

  if (existingHashes.has(hash)) {
    console.log(`  ✓ ${entry.tag} (${hash.slice(0, 12)}…) already in journal`);
    continue;
  }

  await c.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, entry.when]
  );
  console.log(`  ➕ ${entry.tag} (${hash.slice(0, 12)}…) backfilled`);
  backfilled += 1;
}

const after = await c.query(
  `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
);
console.log(
  `\ndone: ${backfilled} backfilled, total now ${after.rows[0].n}`
);

await c.end();
