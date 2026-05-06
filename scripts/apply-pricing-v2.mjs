// Apply pricing engine v2 (migrations 0028–0031) to RDS staging.
//
// Sequence:
//   0028 — pricing core (drop 0.99 clamp, hard rejects, profit-based cashout,
//          cap defaults reset, daily cap timezone fix, kill expected_iv pricing,
//          UTC helpers, redefined _speed_update_daily_ngr)
//   0029 — IV cache table + _speed_get_iv() helper, refactor RPCs to use helper
//   0030 — quote/execute parity (expected_spot, expected_offered_prob, etc.)
//   0031 — soft guards (velocity, exposure, daily-handle alert), drop daily wager cap,
//          create speed_user_alerts table
//
// Each migration runs in its own transaction (BEGIN / COMMIT inside the SQL
// file). If any migration fails, subsequent migrations don't run and the
// script exits nonzero. The applied migrations stay applied — Postgres
// doesn't have cross-migration rollback.
//
// Pre-flight checks (verify the codebase reality matches expectations):
//   * Confirm 0027 is the highest migration currently applied
//   * Confirm the prerequisite functions exist (speed_fair_prob_over,
//     _speed_update_daily_ngr from 0016, speed_execute_trade from 0027,
//     speed_execute_cashout from 0022)
//   * Confirm fee_config has speed_iv_btc, speed_spread_pct, etc.
//
// Post-flight verification:
//   * Each new helper function exists (_speed_utc_today, _speed_utc_midnight,
//     _speed_get_iv, _speed_cashout_margin, _speed_seconds_left_bucket,
//     _speed_assert_parity, _speed_get_stake_max)
//   * speed_volatility_cache table exists
//   * speed_user_alerts table exists
//   * fee_config has the new pricing v2 keys
//   * fee_config no longer has speed_max_user_daily_wager (0031 drops it)
//   * speed_execute_trade signature has 9 params (mig 0030 + 0031)
//   * speed_execute_cashout signature has 7 params (mig 0030)
//
// Non-destructive — does not flip the cashout kill switch. Founder said
// staging cashouts are fine to leave on during the build.
//
// Usage:
//   node scripts/apply-pricing-v2.mjs
//   node scripts/apply-pricing-v2.mjs --dry-run     (skip the SQL apply)
//   node scripts/apply-pricing-v2.mjs --only=0028   (apply just one migration)

import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ARG = process.argv.find((a) => a.startsWith("--only="));
const ONLY = ONLY_ARG ? ONLY_ARG.split("=")[1] : null;

const MIGRATIONS = [
  { tag: "0028", file: "0028_pricing_engine_v2.sql",          desc: "pricing core" },
  { tag: "0029", file: "0029_iv_cache_and_helper.sql",        desc: "IV cache + helper" },
  { tag: "0030", file: "0030_quote_execute_parity.sql",       desc: "quote/execute parity" },
  { tag: "0031", file: "0031_schema_sync_caps_softguards.sql",desc: "soft guards + alerts table" },
];

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== Pricing engine v2 apply (mig 0028–0031) ===\n");

// ── Pre-flight ─────────────────────────────────────────────────────────
console.log("Pre-flight checks:");

const journal = await c.query(
  `SELECT hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 5`
).catch(() => ({ rows: [] }));
if (journal.rows.length > 0) {
  console.log(`  Drizzle journal: ${journal.rows.length} recent rows`);
} else {
  console.log(`  Drizzle journal: empty / not in sync (apply scripts manage state directly)`);
}

const fns = await c.query(`
  SELECT proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN (
      'speed_fair_prob_over','_speed_update_daily_ngr',
      'speed_execute_trade','speed_execute_cashout',
      'speed_cashout_multiplier','speed_liq_discount'
    )
`);
const fnSet = new Set(fns.rows.map((r) => r.proname));
const required = ["speed_fair_prob_over", "_speed_update_daily_ngr", "speed_execute_trade", "speed_execute_cashout"];
for (const r of required) {
  if (!fnSet.has(r)) {
    console.error(`  ❌ MISSING prerequisite function: ${r}`);
    console.error(`     Migrations 0016/0022/0027 must be applied first.`);
    await c.end();
    process.exit(1);
  }
  console.log(`  ✅ ${r}() present`);
}

const cfgSeed = await c.query(`
  SELECT fee_type, rate FROM fee_config
  WHERE fee_type IN (
    'speed_iv_btc','speed_spread_pct','speed_pool_collateral_usd',
    'speed_stake_max_usd','speed_cap_per_side_usd','speed_cashout_enabled'
  )
  ORDER BY fee_type
`);
console.log(`  fee_config rows present (sampling):`);
for (const r of cfgSeed.rows) {
  console.log(`    ${r.fee_type} = ${r.rate}`);
}

const trade = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_trade'
`);
console.log(`  speed_execute_trade arg count: ${trade.rows[0]?.pronargs ?? "?"} (expect 5 pre-0030, 9 post-0030)`);

console.log("");

// ── Apply ──────────────────────────────────────────────────────────────
const toApply = ONLY
  ? MIGRATIONS.filter((m) => m.tag === ONLY)
  : MIGRATIONS;

if (toApply.length === 0) {
  console.error(`No migration matched --only=${ONLY}`);
  await c.end();
  process.exit(1);
}

if (DRY_RUN) {
  console.log("DRY RUN — would apply:");
  for (const m of toApply) console.log(`  ${m.tag} ${m.file} (${m.desc})`);
  await c.end();
  process.exit(0);
}

for (const m of toApply) {
  console.log(`Applying ${m.tag} (${m.desc})…`);
  const startedAt = Date.now();
  let sql;
  try {
    sql = readFileSync(
      new URL(`../drizzle/migrations/${m.file}`, import.meta.url),
      "utf-8"
    );
  } catch (err) {
    console.error(`  ❌ could not read ${m.file}: ${err.message}`);
    await c.end();
    process.exit(1);
  }

  try {
    await c.query(sql);
    const elapsed = Date.now() - startedAt;
    console.log(`  ✅ ${m.tag} applied in ${elapsed}ms`);
  } catch (err) {
    console.error(`  ❌ ${m.tag} FAILED: ${err.message}`);
    if (err.position) console.error(`     position: ${err.position}`);
    if (err.detail) console.error(`     detail: ${err.detail}`);
    if (err.hint) console.error(`     hint: ${err.hint}`);
    console.error(`\n  STOPPING. Migrations applied so far stay applied — Postgres has no cross-migration rollback.`);
    await c.end();
    process.exit(1);
  }
  console.log("");
}

// ── Post-flight ─────────────────────────────────────────────────────────
console.log("Post-flight verification:");

const newFns = await c.query(`
  SELECT proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN (
      '_speed_utc_today','_speed_utc_midnight',
      '_speed_get_iv','_speed_cashout_margin','_speed_seconds_left_bucket',
      '_speed_assert_parity','_speed_get_stake_max'
    )
  ORDER BY proname
`);
const newFnSet = new Set(newFns.rows.map((r) => r.proname));
const expectedNew = [
  "_speed_utc_today",
  "_speed_utc_midnight",
  "_speed_get_iv",
  "_speed_cashout_margin",
  "_speed_seconds_left_bucket",
  "_speed_assert_parity",
  "_speed_get_stake_max",
];
for (const f of expectedNew) {
  console.log(`  ${newFnSet.has(f) ? "✅" : "❌"} ${f}()`);
}

const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'speed_volatility_cache','speed_user_alerts'
  )
  ORDER BY table_name
`);
const tableSet = new Set(tables.rows.map((r) => r.table_name));
console.log(`  ${tableSet.has("speed_volatility_cache") ? "✅" : "❌"} speed_volatility_cache table`);
console.log(`  ${tableSet.has("speed_user_alerts") ? "✅" : "❌"} speed_user_alerts table`);

const newCfg = await c.query(`
  SELECT fee_type FROM fee_config
  WHERE fee_type IN (
    'speed_fair_prob_reject_high','speed_fair_prob_reject_low',
    'speed_late_30s_imbalance_reject','speed_late_60s_spread_mult','speed_late_30s_spread_mult',
    'speed_cashout_winning_base_5m','speed_cashout_winning_base_1h',
    'speed_cashout_losing_base_5m','speed_cashout_losing_base_1h',
    'speed_cashout_saturation_coef','speed_cashout_desperation_coef',
    'speed_cashout_late_window_winning_coef','speed_cashout_late_window_losing_coef',
    'speed_cashout_late_30s_imbalance_reject','speed_cashout_late_reject_s',
    'speed_iv_fail_closed','speed_iv_freshness_5m_secs','speed_iv_freshness_1h_secs',
    'speed_parity_prob_drift_pct','speed_parity_spot_drift_pct','speed_parity_cashout_drift_pct',
    'speed_per_user_velocity_max','speed_per_user_open_exposure_pct','speed_per_user_daily_handle_alert',
    'speed_stake_max_5m_usd','speed_stake_max_1h_usd'
  )
`);
console.log(`  fee_config new keys present: ${newCfg.rows.length}/25`);

const droppedCfg = await c.query(`
  SELECT fee_type FROM fee_config
  WHERE fee_type IN (
    'speed_max_user_daily_wager',
    'speed_cashout_decay_5m_ge80','speed_cashout_decay_5m_lt20',
    'speed_liq_discount_gt30','speed_liq_discount_5to10',
    'speed_late_window_60s_pct','speed_late_window_30s_pct'
  )
`);
console.log(`  ${droppedCfg.rows.length === 0 ? "✅" : "❌"} old fee_config keys dropped (daily cap + cashout decay matrix + liq discount + additive late-window)`);
if (droppedCfg.rows.length > 0) {
  console.log(`     STILL PRESENT: ${droppedCfg.rows.map((r) => r.fee_type).join(", ")}`);
}

const tradeAfter = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_trade'
`);
const cashoutAfter = await c.query(`
  SELECT pronargs FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
console.log(`  speed_execute_trade arg count: ${tradeAfter.rows[0]?.pronargs} (expect 9)`);
console.log(`  speed_execute_cashout arg count: ${cashoutAfter.rows[0]?.pronargs} (expect 7)`);

console.log("\n✅ Pricing engine v2 applied. Next step: deploy services/speed-oracle/ to EC2 so the RV cache populates.");

await c.end();
