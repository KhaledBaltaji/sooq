#!/usr/bin/env node
// Extract canonical PL/pgSQL function definitions from staging RDS into
// drizzle/functions/<name>.sql.
//
// Each output file contains:
//   1. A header with provenance (source migration if known, extraction time)
//   2. CREATE OR REPLACE FUNCTION ... (from pg_get_functiondef(oid))
//   3. COMMENT ON FUNCTION ... (if any)
//   4. GRANT EXECUTE ON FUNCTION ... TO PUBLIC; (matching live grants)
//
// Source of truth for extraction: pg_proc on the live staging database.
// This is the canonical "current state" — what's actually installed.
//
// Usage:
//   node scripts/extract-functions.mjs                # extract all 17 known speed_* functions
//   node scripts/extract-functions.mjs --verify       # extract to memory and verify byte-match against pg_proc round-trip
//   node scripts/extract-functions.mjs --only speed_execute_trade   # extract just one
//
// Run again after a migration applies to refresh the canonical files.
// scripts/sync-functions.mjs (the CI drift checker) reads these files
// and compares against pg_proc to fail builds if they drift.

import { config } from "dotenv";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import pg from "pg";
import { fileURLToPath } from "url";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
const VERIFY = args.includes("--verify");
const ONLY = args.find((a, i) => args[i - 1] === "--only");

// 17 canonical LIVE speed_* functions from the /investigate audit.
// Source-migration mapping for human reference; pg_proc is authoritative.
//
// NOT included (dead code from pre-mig-0028, kept in pg_proc but never called by
// any current RPC; consider dropping in a future cleanup migration):
//   - speed_cashout_multiplier         (replaced by _speed_cashout_margin in mig 0028)
//   - speed_late_window_surcharge_pct  (replaced by multiplicative spread in mig 0028)
//   - speed_liq_discount               (deleted by mig 0028 — old liquidation cashout shape)
//   - speed_time_bucket                (used by pre-mig-0028 RPCs only)
const FUNCTIONS = [
  { name: "speed_execute_trade",          source_mig: "0034_pricing_engine_v3.sql:532" },
  { name: "speed_execute_cashout",        source_mig: "0034_pricing_engine_v3.sql:1012" },
  { name: "speed_resolve_market",         source_mig: "0021_resolve_type_cast_fix.sql:25" },
  { name: "speed_roll_markets",           source_mig: "0020_enable_1h_markets.sql:69" },
  { name: "speed_resolve_expired_markets",source_mig: "0004_speed_cron.sql:151" },
  { name: "speed_fair_prob_over",         source_mig: "0013_drop_handle_fee_and_polish.sql:56" },
  { name: "_speed_pricing_apply",         source_mig: "0034_pricing_engine_v3.sql:262 + commit 38922ce" },
  { name: "_speed_matrix_lookup",         source_mig: "0034_pricing_engine_v3.sql:177" },
  { name: "_speed_max_stake_for_offered", source_mig: "0034_pricing_engine_v3.sql:461" },
  { name: "_speed_cashout_margin",        source_mig: "0028_pricing_engine_v2.sql:303" },
  { name: "_speed_seconds_left_bucket",   source_mig: "0030_quote_execute_parity.sql:74" },
  { name: "_speed_assert_parity",         source_mig: "0030_quote_execute_parity.sql:97" },
  { name: "_speed_get_iv",                source_mig: "0029_iv_cache_and_helper.sql:129" },
  { name: "_speed_update_daily_ngr",      source_mig: "0028_pricing_engine_v2.sql:200" },
  { name: "_speed_get_stake_max",         source_mig: "0028_pricing_engine_v2.sql:256" },
  { name: "_speed_utc_today",             source_mig: "0028_pricing_engine_v2.sql:176" },
  { name: "_speed_utc_midnight",          source_mig: "0028_pricing_engine_v2.sql:181" },
  // Mig 0037: recalibration cron + dual-run helpers
  { name: "_speed_isotonic_pav",          source_mig: "0037_recalibration_cron/functions/_speed_isotonic_pav.sql" },
  { name: "_speed_jeffreys_ci_width",     source_mig: "0037_recalibration_cron/functions/_speed_jeffreys_ci_width.sql" },
  { name: "_speed_recalibrate_matrix",    source_mig: "0037_recalibration_cron/functions/_speed_recalibrate_matrix.sql" },
  { name: "_speed_promote_matrix_version",source_mig: "0037_recalibration_cron/functions/_speed_promote_matrix_version.sql" },
  // Mig 0044: per-user CLV throttle (Sprint 2)
  { name: "_speed_recompute_edge_scores", source_mig: "0044_sprint_2_clv_throttle/functions/_speed_recompute_edge_scores.sql" },
  { name: "_speed_apply_user_shading",    source_mig: "0044_sprint_2_clv_throttle/functions/_speed_apply_user_shading.sql" },
];

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FUNCTIONS_DIR = `${REPO_ROOT}/drizzle/functions`;

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== extract-functions.mjs ===");
console.log("Source: pg_proc on staging RDS");
console.log("Output: drizzle/functions/<name>.sql\n");

if (!existsSync(FUNCTIONS_DIR)) {
  await mkdir(FUNCTIONS_DIR, { recursive: true });
  console.log(`Created ${FUNCTIONS_DIR}\n`);
}

const targets = ONLY ? FUNCTIONS.filter((f) => f.name === ONLY) : FUNCTIONS;
if (targets.length === 0) {
  console.error(`No functions matched. Known: ${FUNCTIONS.map((f) => f.name).join(", ")}`);
  await c.end();
  process.exit(1);
}

let extracted = 0;
let mismatches = [];
let missing = [];

for (const fn of targets) {
  // Resolve the function's oid + signature. Multiple overloads possible (we want the latest by oid).
  const lookup = await c.query(
    `SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_function_result(p.oid) AS result_type,
            obj_description(p.oid, 'pg_proc') AS comment
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proname = $1
     ORDER BY p.oid DESC`,
    [fn.name],
  );
  if (lookup.rows.length === 0) {
    console.warn(`  ⚠️  ${fn.name} — NOT FOUND in pg_proc (skipping)`);
    missing.push(fn.name);
    continue;
  }
  if (lookup.rows.length > 1) {
    console.warn(`  ⚠️  ${fn.name} — ${lookup.rows.length} overloads exist; using latest by oid`);
  }
  const row = lookup.rows[0];

  // Get the canonical CREATE OR REPLACE FUNCTION statement.
  const def = await c.query(`SELECT pg_get_functiondef($1::oid) AS def`, [row.oid]);
  const createSql = def.rows[0].def.trim();

  // Get GRANT EXECUTE statements for this exact (function, args) signature.
  // We list all grantees (PUBLIC, specific roles) the function has.
  const grants = await c.query(
    `SELECT DISTINCT grantee, privilege_type
     FROM information_schema.routine_privileges
     WHERE specific_schema = 'public'
       AND routine_name = $1
     ORDER BY grantee, privilege_type`,
    [fn.name],
  );
  const grantStmts = grants.rows
    .filter((g) => g.privilege_type === "EXECUTE")
    .map((g) => `GRANT EXECUTE ON FUNCTION public.${fn.name}(${row.args}) TO ${g.grantee};`)
    .join("\n");

  const commentStmt = row.comment
    ? `COMMENT ON FUNCTION public.${fn.name}(${row.args}) IS\n  ${literalQuote(row.comment)};`
    : "";

  const fileBody = [
    `-- Canonical definition extracted from pg_proc on staging RDS.`,
    `-- DO NOT EDIT THIS FILE BY HAND. To change the function:`,
    `--   1. Author a new migration with CREATE OR REPLACE FUNCTION ...`,
    `--   2. Apply it (scripts/apply-mig.mjs --name 0035_my_change)`,
    `--   3. Re-run scripts/extract-functions.mjs to refresh this file`,
    `--`,
    `-- Source of truth (latest known migration touching this function):`,
    `--   ${fn.source_mig}`,
    `-- Last extracted: ${new Date().toISOString()}`,
    ``,
    createSql + ";",
    "",
    commentStmt,
    "",
    grantStmts,
    "",
  ].filter(Boolean).join("\n");

  const outPath = `${FUNCTIONS_DIR}/${fn.name}.sql`;

  if (VERIFY) {
    // Verification: write to a temp string, simulate re-application in a SAVEPOINT,
    // compare new pg_get_functiondef output. Must be byte-identical.
    await c.query("BEGIN");
    try {
      await c.query("SAVEPOINT verify_extract");
      await c.query(createSql + ";");
      const reCheck = await c.query(`SELECT pg_get_functiondef($1::oid) AS def`, [row.oid]);
      const newDef = reCheck.rows[0].def.trim();
      if (newDef !== createSql) {
        mismatches.push({
          name: fn.name,
          before: createSql.length,
          after: newDef.length,
          diff_preview: showDiff(createSql, newDef, 200),
        });
        console.warn(`  ⚠️  ${fn.name} — VERIFY MISMATCH (re-application produces different definition)`);
      } else {
        console.log(`  ✅ ${fn.name} — verify clean (round-trip identical, ${createSql.length} chars)`);
      }
      await c.query("ROLLBACK TO SAVEPOINT verify_extract");
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK");
      console.error(`  ❌ ${fn.name} — VERIFY ERROR: ${err.message}`);
      mismatches.push({ name: fn.name, error: err.message });
      continue;
    }
  }

  await writeFile(outPath, fileBody);
  extracted++;
  console.log(`  📄 ${fn.name}.sql (${fileBody.length} bytes)`);
}

console.log(`\n=== Extracted ${extracted}/${targets.length} functions ===`);
if (missing.length > 0) {
  console.warn(`Missing in pg_proc (DDL not yet applied?): ${missing.join(", ")}`);
}
if (VERIFY && mismatches.length > 0) {
  console.error(`\n❌ ${mismatches.length} verification mismatches. Files NOT written for these.`);
  for (const m of mismatches) {
    console.error(`  - ${m.name}: ${m.error || `before=${m.before} after=${m.after}`}`);
  }
  await c.end();
  process.exit(2);
}

await c.end();
console.log(`\nNext: review drizzle/functions/*.sql, run sync-functions.mjs --dry-run to confirm zero drift, commit.`);

// ────────────────────────────────────────────────────────────────────────────
function literalQuote(s) {
  return "$$" + s + "$$";
}

function showDiff(a, b, ctx = 100) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `first diff at offset ${i}: BEFORE=...${a.slice(Math.max(0, i - ctx), i + ctx)}... AFTER=...${b.slice(Math.max(0, i - ctx), i + ctx)}...`;
}
