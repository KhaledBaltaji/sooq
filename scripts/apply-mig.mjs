#!/usr/bin/env node
// Generic migration applier. Replaces the per-migration apply-mig-XXXX.mjs
// scripts going forward.
//
// New migration layout (folder-based):
//
//   drizzle/migrations/0035_my_change/
//     schema.sql              # CREATE TABLE / ALTER / fee_config INSERT etc.
//     functions/              # any function bodies that changed in this migration
//       speed_execute_trade.sql
//       _speed_pricing_apply.sql
//     preflight.json          # optional: required functions, tables, fee_config keys
//     postflight.json         # optional: expected functions, tables, fee_config keys
//
// Application order:
//   1. Pre-flight checks (per preflight.json)
//   2. BEGIN
//   3. Run schema.sql (if exists)
//   4. For each functions/*.sql in alphabetical order: run it
//   5. COMMIT (single transaction; rollback on any failure)
//   6. Post-flight verification (per postflight.json)
//   7. Refresh drizzle/functions/ from pg_proc (so canonical files stay in sync)
//
// Backward compatibility: also supports legacy single-file migrations by name:
//   node scripts/apply-mig.mjs --file 0034_pricing_engine_v3.sql
//
// Usage:
//   node scripts/apply-mig.mjs --name 0035_my_change          # apply folder
//   node scripts/apply-mig.mjs --name 0035_my_change --dry-run
//   node scripts/apply-mig.mjs --file 0035_legacy.sql          # apply single-file
//
// preflight.json schema:
//   {
//     "functions": ["speed_execute_trade", "_speed_get_iv"],
//     "tables": ["speed_pricing_matrix"],
//     "fee_config_keys": ["speed_spread_pct"],
//     "min_args": { "speed_execute_trade": 9 }
//   }
//
// postflight.json schema:
//   { "functions": [...], "tables": [...], "fee_config_keys": [...], "exact_args": { ... } }

import { config } from "dotenv";
import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import pg from "pg";
import { fileURLToPath } from "url";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
const NAME = args.find((a, i) => args[i - 1] === "--name");
const FILE = args.find((a, i) => args[i - 1] === "--file");
const DRY_RUN = args.includes("--dry-run");
const SKIP_SYNC = args.includes("--skip-sync");

if (!NAME && !FILE) {
  console.error("Usage: node scripts/apply-mig.mjs --name <folder> | --file <single.sql> [--dry-run] [--skip-sync]");
  process.exit(1);
}
if (NAME && FILE) {
  console.error("Cannot combine --name and --file");
  process.exit(1);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = `${REPO_ROOT}/drizzle/migrations`;

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log(`=== apply-mig.mjs (${DRY_RUN ? "dry-run" : "apply"}) ===`);

// ─────────────────────────────────────────────────────────────────────
// Resolve target: folder or single file
// ─────────────────────────────────────────────────────────────────────
let target;
if (FILE) {
  const path = `${MIGRATIONS_DIR}/${FILE}`;
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  target = { kind: "file", path, name: FILE };
  console.log(`Target: single file ${FILE}\n`);
} else {
  const path = `${MIGRATIONS_DIR}/${NAME}`;
  if (!existsSync(path)) {
    console.error(`Folder not found: ${path}`);
    process.exit(1);
  }
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    console.error(`Expected folder, got file: ${path}`);
    console.error(`Use --file ${NAME}.sql for single-file migrations`);
    process.exit(1);
  }
  target = { kind: "folder", path, name: NAME };
  console.log(`Target: folder ${NAME}\n`);
}

// ─────────────────────────────────────────────────────────────────────
// Pre-flight checks
// ─────────────────────────────────────────────────────────────────────
let preflight = null;
if (target.kind === "folder") {
  const preflightPath = `${target.path}/preflight.json`;
  if (existsSync(preflightPath)) {
    preflight = JSON.parse(await readFile(preflightPath, "utf8"));
  }
}

if (preflight) {
  console.log("Pre-flight checks:");
  let failed = false;

  if (preflight.functions) {
    const r = await c.query(
      `SELECT proname FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND proname = ANY($1)`,
      [preflight.functions],
    );
    const found = new Set(r.rows.map((row) => row.proname));
    for (const fn of preflight.functions) {
      if (found.has(fn)) {
        console.log(`  ✅ ${fn}() present`);
      } else {
        console.error(`  ❌ ${fn}() MISSING`);
        failed = true;
      }
    }
  }

  if (preflight.tables) {
    const r = await c.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [preflight.tables],
    );
    const found = new Set(r.rows.map((row) => row.table_name));
    for (const t of preflight.tables) {
      if (found.has(t)) {
        console.log(`  ✅ ${t} table present`);
      } else {
        console.error(`  ❌ ${t} table MISSING`);
        failed = true;
      }
    }
  }

  if (preflight.fee_config_keys) {
    const r = await c.query(`SELECT fee_type FROM fee_config WHERE fee_type = ANY($1)`, [preflight.fee_config_keys]);
    const found = new Set(r.rows.map((row) => row.fee_type));
    for (const k of preflight.fee_config_keys) {
      if (found.has(k)) {
        console.log(`  ✅ fee_config.${k}`);
      } else {
        console.warn(`  ⚠️  fee_config.${k} not present (may be intended new key)`);
      }
    }
  }

  if (preflight.min_args) {
    for (const [fn, expected] of Object.entries(preflight.min_args)) {
      const r = await c.query(
        `SELECT pronargs FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND proname = $1`,
        [fn],
      );
      const actual = parseInt(r.rows[0]?.pronargs ?? "-1", 10);
      if (actual >= expected) {
        console.log(`  ✅ ${fn} has ${actual} args (>= ${expected})`);
      } else {
        console.error(`  ❌ ${fn} has ${actual} args, expected at least ${expected}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error("\nPre-flight FAILED. Aborting.");
    await c.end();
    process.exit(2);
  }
  console.log("");
}

if (DRY_RUN) {
  console.log("DRY RUN — would apply the following:");
  if (target.kind === "file") {
    console.log(`  ${target.name}`);
  } else {
    const schemaPath = `${target.path}/schema.sql`;
    if (existsSync(schemaPath)) console.log(`  ${target.name}/schema.sql`);
    const fnDir = `${target.path}/functions`;
    if (existsSync(fnDir)) {
      const fns = (await readdir(fnDir)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of fns) console.log(`  ${target.name}/functions/${f}`);
    }
  }
  await c.end();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────
const startedAt = Date.now();
console.log("Applying...");

await c.query("BEGIN");
try {
  if (target.kind === "file") {
    const sql = await readFile(target.path, "utf8");
    await c.query(sql);
    console.log(`  ✅ ${target.name} (single file)`);
  } else {
    const schemaPath = `${target.path}/schema.sql`;
    if (existsSync(schemaPath)) {
      const sql = await readFile(schemaPath, "utf8");
      await c.query(sql);
      console.log(`  ✅ schema.sql`);
    } else {
      console.log(`  (no schema.sql)`);
    }

    const fnDir = `${target.path}/functions`;
    if (existsSync(fnDir)) {
      const fns = (await readdir(fnDir)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of fns) {
        const sql = await readFile(`${fnDir}/${f}`, "utf8");
        await c.query(sql);
        console.log(`  ✅ functions/${f}`);
      }
    }
  }

  await c.query("COMMIT");
  const elapsed = Date.now() - startedAt;
  console.log(`\nApplied in ${elapsed}ms`);
} catch (err) {
  await c.query("ROLLBACK");
  console.error(`\n❌ APPLY FAILED: ${err.message}`);
  if (err.position) console.error(`   position: ${err.position}`);
  if (err.detail) console.error(`   detail: ${err.detail}`);
  if (err.hint) console.error(`   hint: ${err.hint}`);
  console.error(`\nTransaction rolled back. Database is in pre-apply state.`);
  await c.end();
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────
// Post-flight verification
// ─────────────────────────────────────────────────────────────────────
let postflight = null;
if (target.kind === "folder") {
  const postflightPath = `${target.path}/postflight.json`;
  if (existsSync(postflightPath)) {
    postflight = JSON.parse(await readFile(postflightPath, "utf8"));
  }
}

if (postflight) {
  console.log("\nPost-flight verification:");
  let failed = false;

  if (postflight.functions) {
    const r = await c.query(
      `SELECT proname FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND proname = ANY($1)`,
      [postflight.functions],
    );
    const found = new Set(r.rows.map((row) => row.proname));
    for (const fn of postflight.functions) {
      console.log(`  ${found.has(fn) ? "✅" : "❌"} ${fn}()`);
      if (!found.has(fn)) failed = true;
    }
  }

  if (postflight.tables) {
    const r = await c.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [postflight.tables],
    );
    const found = new Set(r.rows.map((row) => row.table_name));
    for (const t of postflight.tables) {
      console.log(`  ${found.has(t) ? "✅" : "❌"} ${t} table`);
      if (!found.has(t)) failed = true;
    }
  }

  if (postflight.fee_config_keys) {
    const r = await c.query(`SELECT fee_type FROM fee_config WHERE fee_type = ANY($1)`, [postflight.fee_config_keys]);
    const found = new Set(r.rows.map((row) => row.fee_type));
    let n = 0;
    for (const k of postflight.fee_config_keys) {
      if (found.has(k)) n++;
    }
    console.log(`  fee_config keys present: ${n}/${postflight.fee_config_keys.length}`);
  }

  if (postflight.exact_args) {
    for (const [fn, expected] of Object.entries(postflight.exact_args)) {
      const r = await c.query(
        `SELECT pronargs FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND proname = $1`,
        [fn],
      );
      const actual = parseInt(r.rows[0]?.pronargs ?? "-1", 10);
      if (actual === expected) {
        console.log(`  ✅ ${fn} has exactly ${expected} args`);
      } else {
        console.error(`  ❌ ${fn} has ${actual} args, expected exactly ${expected}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error("\nPost-flight FAILED. Migration applied but verification failed — investigate.");
    await c.end();
    process.exit(3);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Auto-refresh canonical drizzle/functions/ (unless --skip-sync)
// ─────────────────────────────────────────────────────────────────────
await c.end();

if (!SKIP_SYNC) {
  console.log("\nRefreshing canonical drizzle/functions/ (--skip-sync to disable)...");
  const { spawn } = await import("child_process");
  await new Promise((resolve) => {
    const p = spawn("node", ["scripts/extract-functions.mjs"], { stdio: "inherit" });
    p.on("close", resolve);
  });
}

console.log("\n✅ Migration complete.");
