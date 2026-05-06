// Read-only RDS introspection for the "mig 369" question.
//
// The frontend, types, and API routes were updated assuming mig 369
// (the pricing-engine-v2 rework) is live. This script reports what
// is actually deployed so we know whether to:
//   (a) commit the existing RDS function bodies as drizzle/0028_*.sql
//       (if a previous session applied them manually without committing), or
//   (b) author 0028 from spec (if RDS still has the pre-369 RPCs).
//
// Run:  node scripts/introspect-mig-369.mjs
// Requires DATABASE_URL in .env.local pointing at RDS staging.

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

console.log("=".repeat(72));
console.log("Mig 369 introspection — read-only");
console.log("=".repeat(72));

// 1. Function signatures: how many args do the speed RPCs actually take?
const sigs = await client.query(`
  SELECT
    p.proname AS name,
    pg_get_function_arguments(p.oid) AS args,
    pg_get_function_result(p.oid) AS returns
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'speed_execute_trade',
      'speed_execute_cashout',
      'speed_resolve_market',
      'speed_fair_prob_over',
      'speed_late_window_surcharge_pct',
      'speed_cashout_multiplier',
      'speed_liq_discount'
    )
  ORDER BY p.proname
`);
console.log("\n--- Deployed function signatures ---");
for (const r of sigs.rows) {
  console.log(`${r.name}(${r.args})`);
  console.log(`  returns: ${r.returns}`);
}
const speedTradeArgCount =
  sigs.rows.find((r) => r.name === "speed_execute_trade")?.args.split(",").length ?? 0;
const speedCashoutArgCount =
  sigs.rows.find((r) => r.name === "speed_execute_cashout")?.args.split(",").length ?? 0;
console.log(
  `\nspeed_execute_trade arg count:    ${speedTradeArgCount} ${
    speedTradeArgCount === 5 ? "(post-369: HAS expected_iv)" : "(pre-369: NO expected_iv)"
  }`
);
console.log(
  `speed_execute_cashout arg count:  ${speedCashoutArgCount} ${
    speedCashoutArgCount === 3 ? "(post-369: HAS expected_iv)" : "(pre-369: NO expected_iv)"
  }`
);

// 2. fee_config — does the post-369 shape exist?
const fees = await client.query(`
  SELECT fee_type, rate
  FROM fee_config
  WHERE fee_type IN (
    -- pre-369 markers (should be GONE post-369)
    'speed_handle_fee_pct',
    'speed_cashout_5m_winner_late', 'speed_cashout_5m_loser_late',
    'speed_cashout_1h_winner_late', 'speed_cashout_1h_loser_late',
    -- post-369 markers (should EXIST post-369)
    'speed_spread_pct',
    'speed_pool_collateral_usd',
    'speed_per_side_cap_pct', 'speed_per_user_per_market_cap_usd',
    'speed_per_user_daily_wager_cap_usd', 'speed_same_strike_cluster_cap_pct',
    'speed_daily_ngr_floor_usd',
    'speed_late_60s_surcharge_pct', 'speed_late_30s_surcharge_pct',
    'speed_cashout_decay_5m_p100', 'speed_cashout_decay_1h_p100',
    'speed_iv_drift_tolerance_pct'
  )
  ORDER BY fee_type
`);
console.log("\n--- fee_config rows (post-369 markers + pre-369 leftovers) ---");
console.table(fees.rows);

const has = (k) => fees.rows.some((r) => r.fee_type === k);
console.log(`\nspeed_handle_fee_pct present:               ${has("speed_handle_fee_pct")} (post-369: should be FALSE)`);
console.log(`speed_pool_collateral_usd present:          ${has("speed_pool_collateral_usd")} (post-369: should be TRUE)`);
console.log(`speed_per_side_cap_pct present:             ${has("speed_per_side_cap_pct")} (post-369: should be TRUE)`);
console.log(`speed_cashout_decay_5m_p100 present:        ${has("speed_cashout_decay_5m_p100")} (post-369: should be TRUE)`);
console.log(`speed_iv_drift_tolerance_pct present:       ${has("speed_iv_drift_tolerance_pct")} (post-369: should be TRUE)`);
console.log(`OLD speed_cashout_5m_winner_late present:   ${has("speed_cashout_5m_winner_late")} (post-369: should be FALSE)`);

const spread = fees.rows.find((r) => r.fee_type === "speed_spread_pct");
if (spread) {
  console.log(`\nspeed_spread_pct = ${spread.rate} (post-369: should be 0.05; pre-369: 0.04)`);
}

// 3. Tables: speed_market_settlement_audit
const tables = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('speed_market_settlement_audit', 'speed_daily_ngr')
  ORDER BY table_name
`);
console.log("\n--- post-369 tables present ---");
console.log(tables.rows.map((r) => r.table_name).join(", ") || "(none)");

// 4. speed_trades.handle_fee column (kept post-369 for historical rows)
const cols = await client.query(`
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'speed_trades' AND column_name = 'handle_fee'
`);
console.log(
  `\nspeed_trades.handle_fee column: ${cols.rows.length ? "present (kept for historical)" : "missing"}`
);

// 5. Verdict
console.log("\n" + "=".repeat(72));
console.log("VERDICT");
console.log("=".repeat(72));
const has5argTrade = speedTradeArgCount === 5;
const has3argCashout = speedCashoutArgCount === 3;
const hasPoolCollateral = has("speed_pool_collateral_usd");
const hasIvDrift = has("speed_iv_drift_tolerance_pct");
const hasOldCashoutKeys = has("speed_cashout_5m_winner_late");
const hasHandleFee = has("speed_handle_fee_pct");

if (has5argTrade && has3argCashout && hasPoolCollateral && hasIvDrift && !hasOldCashoutKeys && !hasHandleFee) {
  console.log("✅ Mig 369 IS DEPLOYED on RDS staging.");
  console.log("   → Action: dump function bodies + fee_config diff, commit as drizzle/migrations/0028_*.sql");
} else if (!has5argTrade && !has3argCashout && !hasPoolCollateral && hasOldCashoutKeys && hasHandleFee) {
  console.log("❌ Mig 369 is NOT deployed. RDS has pre-369 RPCs.");
  console.log("   → Action: author drizzle/migrations/0028_*.sql from CLAUDE.md spec, then apply.");
} else {
  console.log("⚠️  RDS is in a PARTIAL state — some 369 changes applied, others not.");
  console.log("   → Action: review the rows above row-by-row before deciding.");
}

await client.end();
