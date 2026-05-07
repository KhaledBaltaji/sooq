#!/usr/bin/env node
// Drift detector for drizzle/functions/<name>.sql vs live pg_proc state.
//
// Used in two modes:
//   1. CI gate (--dry-run): fail the build if any canonical function file in
//      drizzle/functions/ doesn't match the live database. Prevents merging
//      a PR that changes pg_proc without updating the canonical file.
//   2. Operational sync (--apply): re-apply each canonical function file via
//      CREATE OR REPLACE FUNCTION. Use after restoring from backup or when
//      a hotfix updated pg_proc directly without going through a migration.
//
// Approach (no regex parsing):
//   For each .sql file in drizzle/functions/:
//     1. Snapshot pg_get_functiondef of the live function → "before"
//     2. Open a SAVEPOINT, execute the entire file content
//     3. Snapshot pg_get_functiondef of the (possibly updated) function → "after"
//     4. ROLLBACK TO SAVEPOINT (revert any change)
//     5. If before == after → clean (file matches live)
//     6. If before != after → drift (file is different from live)
//
// Usage:
//   node scripts/sync-functions.mjs --dry-run     # CI mode; exits non-zero on drift
//   node scripts/sync-functions.mjs --apply       # apply canonical files to DB (overwrite live)
//   node scripts/sync-functions.mjs --only speed_execute_trade --dry-run

import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import pg from "pg";
import { fileURLToPath } from "url";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const APPLY = args.includes("--apply");
const ONLY = args.find((a, i) => args[i - 1] === "--only");

if (!DRY_RUN && !APPLY) {
  console.error("Specify --dry-run or --apply");
  process.exit(1);
}
if (DRY_RUN && APPLY) {
  console.error("Cannot combine --dry-run and --apply");
  process.exit(1);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FUNCTIONS_DIR = `${REPO_ROOT}/drizzle/functions`;

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`drizzle/functions/ does not exist. Run scripts/extract-functions.mjs first.`);
  process.exit(1);
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const allFiles = (await readdir(FUNCTIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
const targetFiles = ONLY ? allFiles.filter((f) => f === `${ONLY}.sql`) : allFiles;

console.log(`=== sync-functions.mjs (${DRY_RUN ? "dry-run" : "apply"}) ===`);
console.log(`Comparing ${targetFiles.length} canonical files against pg_proc on staging.\n`);

let drift = 0;
let appliedCount = 0;
let errors = 0;

for (const file of targetFiles) {
  const fnName = file.replace(/\.sql$/, "");
  const path = `${FUNCTIONS_DIR}/${file}`;
  const fileContent = await readFile(path, "utf8");

  // Snapshot live state (oid + def) BEFORE applying file
  const liveBefore = await c.query(
    `SELECT p.oid::int AS oid, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proname = $1
     ORDER BY p.oid DESC LIMIT 1`,
    [fnName],
  );

  if (liveBefore.rows.length === 0) {
    console.warn(`  ⚠️  ${fnName} — NOT in pg_proc; file claims it should exist`);
    drift++;
    continue;
  }

  const beforeDef = liveBefore.rows[0].def.trim();

  // Apply the file in a SAVEPOINT, snapshot the new def, then rollback (dry-run)
  // or commit (apply mode).
  await c.query("BEGIN");
  let driftDetected = false;
  try {
    await c.query("SAVEPOINT sync_check");
    await c.query(fileContent);
    const after = await c.query(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND p.proname = $1
       ORDER BY p.oid DESC LIMIT 1`,
      [fnName],
    );
    const afterDef = after.rows[0].def.trim();
    driftDetected = beforeDef !== afterDef;

    if (DRY_RUN) {
      // Always rollback in dry-run; we never modify state
      await c.query("ROLLBACK TO SAVEPOINT sync_check");
      await c.query("COMMIT");
    } else if (APPLY) {
      if (driftDetected) {
        // Keep the file's version; release savepoint to commit it
        await c.query("RELEASE SAVEPOINT sync_check");
        await c.query("COMMIT");
        appliedCount++;
      } else {
        // No change needed; rollback the savepoint (file matches live)
        await c.query("ROLLBACK TO SAVEPOINT sync_check");
        await c.query("COMMIT");
      }
    }
  } catch (err) {
    await c.query("ROLLBACK");
    console.error(`  ❌ ${fnName} — apply failed: ${err.message}`);
    errors++;
    continue;
  }

  if (driftDetected) {
    drift++;
    let firstDiff = 0;
    while (firstDiff < beforeDef.length && firstDiff < beforeDef.length && beforeDef[firstDiff] === fileContent.includes("CREATE OR REPLACE")) {
      firstDiff++;
    }
    console.warn(`  ⚠️  ${fnName} — DRIFT (live ${beforeDef.length} chars vs file produces different definition)`);
    if (DRY_RUN) {
      console.warn(`     to fix: run "node scripts/extract-functions.mjs --only ${fnName}" to refresh canonical file`);
      console.warn(`     OR: "node scripts/sync-functions.mjs --apply --only ${fnName}" to overwrite live with canonical`);
    } else if (APPLY) {
      console.log(`     ✅ canonical version applied to live (live state overwritten)`);
    }
  } else {
    console.log(`  ✅ ${fnName} — clean`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files compared: ${targetFiles.length}`);
console.log(`Drift: ${drift}`);
if (APPLY) {
  console.log(`Applied: ${appliedCount}, errors: ${errors}`);
}

await c.end();

if (DRY_RUN && drift > 0) {
  console.error(`\n❌ ${drift} canonical file(s) drift from pg_proc. CI gate FAILED.`);
  process.exit(2);
}
if (APPLY && errors > 0) {
  process.exit(3);
}
process.exit(0);
