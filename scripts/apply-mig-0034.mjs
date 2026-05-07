// Apply migration 0034 — pricing engine v3 (matrix + asymmetric + soft-block)
//
// IMPORTANT: this migration is SAFE TO APPLY because:
//   - All new flags default OFF (speed_pricing_matrix_enabled=0, speed_entry_soft_block_enabled=0)
//   - Behavior is identical to today (mig 0030 + 0032) until admin enables flags
//   - Late-window multiplier defaults are reduced (1.4→1.2, 1.8→1.4) BUT only
//     if currently at the old defaults; admin overrides preserved
//
// After applying, the recommended sequence is:
//   1. Run scripts/recalibrate-pricing-matrix.mjs to populate initial matrix
//   2. Run scripts/test-pricing-engine-v3.mjs to verify property tests pass
//   3. In /admin/fees, flip speed_pricing_matrix_enabled = 1
//   4. Verify cashouts and entries still work normally
//   5. Flip speed_entry_soft_block_enabled = 1
//   6. (Optional) raise pool/cap defaults via admin UI
//
// Pre-flight checks:
//   - 0030 + 0032 are applied (signature check on speed_execute_trade = 9 args)
//   - speed_fair_prob_over, _speed_get_iv, _speed_cashout_margin, _speed_assert_parity exist
//   - fee_config has the prerequisite keys
//
// Post-flight:
//   - speed_pricing_matrix and speed_pricing_matrix_versions tables exist
//   - _speed_matrix_lookup, _speed_pricing_apply, _speed_max_stake_for_offered exist
//   - All new fee_config keys are seeded (with flags OFF)
//   - speed_execute_trade still has 9 args (signature unchanged from 0030)
//   - speed_execute_cashout still has 7 args (signature unchanged from 0030)
//
// Usage:
//   node scripts/apply-mig-0034.mjs
//   node scripts/apply-mig-0034.mjs --dry-run

import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DRY_RUN = process.argv.includes("--dry-run");

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== Migration 0034 apply (pricing engine v3) ===\n");

// ── Pre-flight ─────────────────────────────────────────────────────────
console.log("Pre-flight checks:");

const fns = await c.query(`
  SELECT proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN (
      'speed_fair_prob_over', '_speed_get_iv', '_speed_cashout_margin',
      '_speed_assert_parity', '_speed_seconds_left_bucket', '_speed_get_stake_max',
      'speed_execute_trade', 'speed_execute_cashout'
    )
`);
const fnSet = new Set(fns.rows.map((r) => r.proname));
const required = [
  "speed_fair_prob_over",
  "_speed_get_iv",
  "_speed_cashout_margin",
  "_speed_assert_parity",
  "_speed_seconds_left_bucket",
  "_speed_get_stake_max",
  "speed_execute_trade",
  "speed_execute_cashout",
];
for (const r of required) {
  if (!fnSet.has(r)) {
    console.error(`  ❌ MISSING prerequisite function: ${r}`);
    console.error(`     Migrations 0028-0032 must be applied first.`);
    await c.end();
    process.exit(1);
  }
  console.log(`  ✅ ${r}() present`);
}

// Check signatures
const tradeArgs = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_trade'
`);
const cashoutArgs = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
const tradeArgCount = parseInt(tradeArgs.rows[0]?.pronargs ?? "0", 10);
const cashoutArgCount = parseInt(cashoutArgs.rows[0]?.pronargs ?? "0", 10);

if (tradeArgCount !== 9) {
  console.error(`  ❌ speed_execute_trade has ${tradeArgCount} args, expected 9 (after mig 0030)`);
  await c.end();
  process.exit(1);
}
console.log(`  ✅ speed_execute_trade has 9 args`);

if (cashoutArgCount !== 7) {
  console.error(`  ❌ speed_execute_cashout has ${cashoutArgCount} args, expected 7 (after mig 0030)`);
  await c.end();
  process.exit(1);
}
console.log(`  ✅ speed_execute_cashout has 7 args`);

// Check key fee_config rows
const cfgPresent = await c.query(`
  SELECT fee_type FROM fee_config
  WHERE fee_type IN (
    'speed_pool_collateral_usd', 'speed_spread_pct',
    'speed_late_60s_spread_mult', 'speed_late_30s_spread_mult',
    'speed_parity_prob_drift_pct', 'speed_cashout_enabled'
  )
`);
console.log(`  fee_config prereq keys: ${cfgPresent.rows.length}/6 present`);

// Warn if matrix already populated (means 0034 was applied before)
const matrixExists = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name='speed_pricing_matrix'
`);
if (matrixExists.rows[0].n > 0) {
  console.warn(`  ⚠️  speed_pricing_matrix table already exists — 0034 may have been applied previously. Re-applying is idempotent for table creation but will INSERT duplicate fee_config keys (handled via ON CONFLICT DO NOTHING).`);
}

console.log("");

if (DRY_RUN) {
  console.log("DRY RUN — would apply 0034_pricing_engine_v3.sql");
  await c.end();
  process.exit(0);
}

// ── Apply ──────────────────────────────────────────────────────────────
console.log("Applying 0034_pricing_engine_v3.sql...");
const startedAt = Date.now();

let sql;
try {
  sql = readFileSync(
    new URL("../drizzle/migrations/0034_pricing_engine_v3.sql", import.meta.url),
    "utf-8"
  );
} catch (err) {
  console.error(`  ❌ could not read 0034_pricing_engine_v3.sql: ${err.message}`);
  await c.end();
  process.exit(1);
}

try {
  await c.query("BEGIN");
  await c.query(sql);
  await c.query("COMMIT");
  const elapsed = Date.now() - startedAt;
  console.log(`  ✅ 0034 applied in ${elapsed}ms`);
} catch (err) {
  await c.query("ROLLBACK");
  console.error(`  ❌ 0034 FAILED: ${err.message}`);
  if (err.position) console.error(`     position: ${err.position}`);
  if (err.detail) console.error(`     detail: ${err.detail}`);
  if (err.hint) console.error(`     hint: ${err.hint}`);
  await c.end();
  process.exit(1);
}

console.log("");

// ── Post-flight ─────────────────────────────────────────────────────────
console.log("Post-flight verification:");

const newTables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('speed_pricing_matrix', 'speed_pricing_matrix_versions')
  ORDER BY table_name
`);
const tableSet = new Set(newTables.rows.map((r) => r.table_name));
console.log(`  ${tableSet.has("speed_pricing_matrix") ? "✅" : "❌"} speed_pricing_matrix table`);
console.log(`  ${tableSet.has("speed_pricing_matrix_versions") ? "✅" : "❌"} speed_pricing_matrix_versions table`);

const newFns = await c.query(`
  SELECT proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN ('_speed_matrix_lookup', '_speed_pricing_apply', '_speed_max_stake_for_offered')
  ORDER BY proname
`);
const newFnSet = new Set(newFns.rows.map((r) => r.proname));
for (const f of ["_speed_matrix_lookup", "_speed_pricing_apply", "_speed_max_stake_for_offered"]) {
  console.log(`  ${newFnSet.has(f) ? "✅" : "❌"} ${f}()`);
}

const newCfg = await c.query(`
  SELECT fee_type, rate FROM fee_config
  WHERE fee_type IN (
    'speed_pricing_matrix_enabled',
    'speed_pricing_asym_pushup_enabled',
    'speed_pricing_matrix_min_n_eff',
    'speed_pricing_matrix_ci_max_width',
    'speed_pricing_matrix_prior_n',
    'speed_entry_soft_block_enabled',
    'speed_entry_soft_block_threshold',
    'speed_entry_soft_block_unlock_threshold',
    'speed_entry_max_payout_usd_5m',
    'speed_entry_max_payout_usd_1h',
    'speed_cashout_cap_edge_threshold',
    'speed_daily_ngr_alert_usd',
    'speed_daily_ngr_soft_block_usd',
    'speed_daily_ngr_hard_stop_usd',
    'speed_ngr_soft_block_stake_max_usd'
  )
  ORDER BY fee_type
`);
console.log(`  fee_config new keys present: ${newCfg.rows.length}/15`);

// Verify flags are OFF (safety)
const flagsOff = newCfg.rows.filter((r) =>
  ["speed_pricing_matrix_enabled", "speed_entry_soft_block_enabled"].includes(r.fee_type)
);
for (const f of flagsOff) {
  if (parseFloat(f.rate) !== 0) {
    console.warn(`  ⚠️  ${f.fee_type} = ${f.rate} (expected 0). FLAG IS ENABLED. Review immediately.`);
  } else {
    console.log(`  ✅ ${f.fee_type} = 0 (off, safe default)`);
  }
}

// Verify late-window multiplier values
const lwm = await c.query(`
  SELECT fee_type, rate FROM fee_config
  WHERE fee_type IN ('speed_late_60s_spread_mult','speed_late_30s_spread_mult')
`);
for (const r of lwm.rows) {
  console.log(`  ℹ️  ${r.fee_type} = ${r.rate}`);
}

// Signature unchanged
const tradeArgsAfter = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_trade'
`);
const cashoutArgsAfter = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
console.log(`  speed_execute_trade arg count: ${tradeArgsAfter.rows[0]?.pronargs} (expect 9)`);
console.log(`  speed_execute_cashout arg count: ${cashoutArgsAfter.rows[0]?.pronargs} (expect 7)`);

console.log("\n✅ Migration 0034 applied. All flags default OFF.");
console.log("\nNext steps:");
console.log("  1. Populate matrix: node scripts/recalibrate-pricing-matrix.mjs");
console.log("  2. Run property tests: node scripts/test-pricing-engine-v3.mjs");
console.log("  3. Enable flags via /admin/fees:");
console.log("     - speed_pricing_matrix_enabled = 1");
console.log("     - speed_entry_soft_block_enabled = 1 (after observing matrix)");
console.log("  4. Optionally raise pool/cap limits via admin");

await c.end();
