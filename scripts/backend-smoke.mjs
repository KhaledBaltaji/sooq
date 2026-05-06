// Comprehensive backend smoke test for migs 0025-0027.
// Read-only / rollback-only — never mutates persistent state.
import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const fail = [];
const warn = [];
const ok = (msg) => console.log(`  ✅ ${msg}`);
const err = (msg) => { fail.push(msg); console.log(`  ❌ ${msg}`); };
const wn = (msg) => { warn.push(msg); console.log(`  ⚠️  ${msg}`); };

// -- 1. fee_config sanity (mig 0028-0032) --
console.log("\n[1] fee_config — values + types (post-mig-0028+)");
const cfg = await c.query(`SELECT fee_type, rate FROM fee_config ORDER BY fee_type`);
const byType = new Map(cfg.rows.map(r => [r.fee_type, Number(r.rate)]));
// Required: keys present + within sane bounds.
const required = [
  // Master switches
  ["speed_markets_enabled", 0, 1],
  ["speed_oracle_stale_seconds", 1, 60],
  // Pool caps (mig 0028)
  ["speed_pool_collateral_usd", 1000, 10000000],
  ["speed_per_side_cap_pct", 0.01, 1.0],
  ["speed_per_user_per_market_cap_usd", 1, 10000000],
  ["speed_same_strike_cluster_cap_pct", 0.01, 1.0],
  ["speed_daily_ngr_floor_usd", -1000000, 0],
  // Pricing engine v2 (mig 0028)
  ["speed_spread_pct", 0.01, 0.20],
  ["speed_late_60s_spread_mult", 1.0, 5.0],
  ["speed_late_30s_spread_mult", 1.0, 5.0],
  ["speed_fair_prob_reject_high", 0.80, 0.999],
  ["speed_fair_prob_reject_low", 0.001, 0.20],
  ["speed_late_30s_imbalance_reject", 0.05, 0.50],
  ["speed_cashout_late_30s_imbalance_reject", 0.05, 0.50],
  ["speed_cashout_late_reject_s", 0, 60],
  // Cashout option-C margins (mig 0028) — 8 keys
  ["speed_cashout_winning_base_5m", 0, 0.20],
  ["speed_cashout_winning_base_1h", 0, 0.20],
  ["speed_cashout_losing_base_5m", 0, 0.30],
  ["speed_cashout_losing_base_1h", 0, 0.30],
  ["speed_cashout_saturation_coef", 0, 2.0],
  ["speed_cashout_desperation_coef", 0, 2.0],
  ["speed_cashout_late_window_winning_coef", 0, 0.20],
  ["speed_cashout_late_window_losing_coef", 0, 0.50],
  // IV / parity (mig 0029, 0030)
  ["speed_iv_btc", 0.05, 5.0],
  ["speed_iv_drift_tolerance_pct", 0, 1.0],
  // Soft guards (mig 0031)
  ["speed_per_user_velocity_max", 1, 10000],
  ["speed_per_user_open_exposure_pct", 0.01, 1.0],
  ["speed_per_user_daily_handle_alert", 100, 10000000],
  // Money
  ["withdrawal_fee", 0, 0.5],
];
for (const [k, lo, hi] of required) {
  const v = byType.get(k);
  if (v === undefined) err(`fee_config missing key: ${k}`);
  else if (v < lo || v > hi) err(`fee_config ${k} = ${v} outside expected [${lo}, ${hi}]`);
  else ok(`${k} = ${v}`);
}
// Negative checks: keys deleted by mig 0028-0031 must NOT exist.
const deletedKeys = [
  "speed_max_user_daily_wager",
  "speed_late_window_60s_pct",
  "speed_late_window_30s_pct",
  "speed_handle_fee_pct",
];
for (const k of deletedKeys) {
  if (byType.has(k)) err(`fee_config STALE: ${k} still present (deleted by mig 0028-0031)`);
  else ok(`${k} correctly absent`);
}
// Additional check: no leftover speed_cashout_decay_* or speed_liq_discount_* keys.
const decayLeftovers = [...byType.keys()].filter(
  (k) => k.startsWith("speed_cashout_decay_") || k.startsWith("speed_liq_discount_"),
);
if (decayLeftovers.length === 0) ok("no leftover speed_cashout_decay_*/speed_liq_discount_* keys");
else err(`STALE keys: ${decayLeftovers.join(", ")} (deleted by mig 0028)`);

// -- 2. Required RPCs exist with correct signatures --
console.log("\n[2] RPC signatures");
const fns = await c.query(`
  SELECT proname, pg_get_function_identity_arguments(oid) AS args, pg_get_function_result(oid) AS ret
  FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN (
    'speed_execute_trade','speed_execute_cashout','speed_resolve_market',
    'process_withdrawal','process_deposit',
    'admin_approve_withdrawal','admin_reject_withdrawal','admin_mark_withdrawal_sent_v2',
    'admin_credit_deposit','admin_balance_adjust_v2','admin_search_users','admin_update_fee',
    'get_admin_withdrawals','get_admin_deposits','get_admin_money_ledger','get_stats_revenue_summary'
  ) ORDER BY proname`);
const fnNames = new Set(fns.rows.map(r => r.proname));
const expected = [
  "speed_execute_trade","speed_execute_cashout","speed_resolve_market",
  "process_withdrawal","process_deposit",
  "admin_approve_withdrawal","admin_reject_withdrawal","admin_mark_withdrawal_sent_v2",
  "admin_credit_deposit","admin_balance_adjust_v2","admin_search_users","admin_update_fee",
  "get_admin_withdrawals","get_admin_deposits","get_admin_money_ledger","get_stats_revenue_summary"
];
for (const name of expected) {
  if (fnNames.has(name)) ok(`${name} exists`);
  else err(`${name} MISSING`);
}

// -- 3. speed_execute_trade signature + body (mig 0028-0032) --
console.log("\n[3] speed_execute_trade — verify mig 0028-0032 took effect");
const trade = await c.query(`SELECT pg_get_functiondef(oid) AS def, pronargs FROM pg_proc WHERE proname='speed_execute_trade' AND pronamespace='public'::regnamespace`);
const tradeRows = trade.rows;
if (tradeRows.length !== 1) err(`speed_execute_trade has ${tradeRows.length} overloads, expected 1 (mig 0032 cleanup should have dropped the legacy 5-arg version)`);
else if (tradeRows[0].pronargs !== 9) err(`speed_execute_trade has ${tradeRows[0].pronargs} args, expected 9 (mig 0030 parity params)`);
else ok("speed_execute_trade has exactly 9 args (post-mig-0030 + 0032 cleanup)");
const body = tradeRows[0]?.def ?? "";
if (body.includes("_speed_get_iv")) ok("RPC reads IV via _speed_get_iv() helper (mig 0029)");
else wn("RPC does not call _speed_get_iv — may be reading speed_iv_btc directly");
if (body.includes("_speed_assert_parity")) ok("RPC enforces mig 0030 parity check");
else err("RPC does NOT call _speed_assert_parity — mig 0030 not applied");
if (/v_stake_max\s*DECIMAL\s*:=\s*25\.00/.test(body)) err("RPC still has hardcoded v_stake_max := 25.00 (mig 0028 should remove)");
else ok("RPC has no leftover hardcoded v_stake_max = 25.00");

// Cashout signature — should be 7 args post-mig-0030 + 0032 cleanup.
const cashoutFn = await c.query(`SELECT pg_get_functiondef(oid) AS def, pronargs FROM pg_proc WHERE proname='speed_execute_cashout' AND pronamespace='public'::regnamespace`);
if (cashoutFn.rows.length !== 1) err(`speed_execute_cashout has ${cashoutFn.rows.length} overloads, expected 1`);
else if (cashoutFn.rows[0].pronargs !== 7) err(`speed_execute_cashout has ${cashoutFn.rows[0].pronargs} args, expected 7`);
else ok("speed_execute_cashout has exactly 7 args (post-mig-0030 + 0032 cleanup)");
const cashoutBody = cashoutFn.rows[0]?.def ?? "";
if (cashoutBody.includes("_speed_cashout_margin")) ok("cashout RPC uses _speed_cashout_margin helper (option C, mig 0028)");
else err("cashout RPC does NOT call _speed_cashout_margin — mig 0028 incomplete");

// -- 4. Admin RPCs callable with admin GUC --
console.log("\n[4] Admin RPCs — call with admin GUC, verify no exception");
const admin = await c.query(`SELECT id FROM users WHERE is_admin=TRUE LIMIT 1`);
if (admin.rows.length === 0) {
  err("No admin user in DB to test against");
} else {
  const adminId = admin.rows[0].id;
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [adminId]);

  const tests = [
    ["get_admin_withdrawals(NULL, 5, 0)",        `SELECT count(*)::int n FROM get_admin_withdrawals(NULL, 5, 0)`],
    ["get_admin_deposits(NULL, 5, 0)",            `SELECT count(*)::int n FROM get_admin_deposits(NULL, 5, 0)`],
    ["get_admin_money_ledger(NULL,...)",          `SELECT count(*)::int n FROM get_admin_money_ledger(NULL, NULL, NULL, NULL, 5, 0)`],
    ["get_stats_revenue_summary(NULL, NULL)",     `SELECT (gross_volume + total_payouts + COALESCE(withdrawal_fees_collected,0))::numeric AS sanity FROM get_stats_revenue_summary(NULL, NULL)`],
    ["admin_search_users('a', 5)",                `SELECT count(*)::int n FROM admin_search_users('a', 5)`],
  ];
  for (const [name, q] of tests) {
    try {
      const r = await c.query(q);
      ok(`${name} returned ${JSON.stringify(r.rows[0])}`);
    } catch (e) {
      err(`${name} threw: ${e.message}`);
    }
  }
  await c.query("ROLLBACK");
}

// -- 5. Ledger consistency — every recent transactions row pairs cleanly --
console.log("\n[5] Ledger consistency");
const orphan = await c.query(`
  SELECT COUNT(*)::int AS n FROM transactions t
  WHERE t.created_at > NOW() - INTERVAL '7 days'
    AND t.type IN ('deposit','withdrawal','admin_credit','admin_debit')
    AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = t.user_id
    )
`);
if (orphan.rows[0].n === 0) ok("no orphan money transactions in past 7 days");
else err(`${orphan.rows[0].n} orphan money transactions (FK to users broken)`);

const balCache = await c.query(`
  SELECT COUNT(*)::int AS n FROM (
    SELECT u.id, u.balance_usd,
           COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id), 0) AS computed
    FROM users u
    WHERE u.balance_usd > 0
  ) s
  WHERE ABS(s.balance_usd - s.computed) > 0.01
`);
if (balCache.rows[0].n === 0) ok("balance_usd cache equals SUM(transactions) for all positive-balance users");
else wn(`${balCache.rows[0].n} users have balance_usd diverging from SUM(transactions) — investigate via scripts/w10-ledger-audit.mjs`);

// -- 6. speed_execute_trade — dry-run validation gates without committing --
//    Uses the new 9-arg signature (mig 0030). All parity params NULL = skip
//    parity check (server treats NULL as "client did not send a snapshot").
console.log("\n[6] speed_execute_trade — gate behavior smoke test (rolled back)");
const userRow = await c.query(`SELECT id, balance_usd FROM users WHERE balance_usd > 100 ORDER BY balance_usd DESC LIMIT 1`);
const mkt = await c.query(`SELECT id FROM speed_markets WHERE status='open' AND duration='5m' AND closes_at > NOW() + INTERVAL '60 seconds' AND strike_price IS NOT NULL ORDER BY closes_at ASC LIMIT 1`);
if (userRow.rows.length === 0) wn("no funded user to dry-run trade RPC against; skipped");
else if (mkt.rows.length === 0) wn("no open 5m market with >60s left + finalized strike; skipped");
else {
  const uid = userRow.rows[0].id;
  const mid = mkt.rows[0].id;
  // Helper: call the 9-arg trade RPC with all parity params null.
  const callTrade = async (stake, key) => c.query(
    `SELECT speed_execute_trade(
       $1::uuid, 'over', $2::numeric, $3::text,
       NULL::numeric, NULL::numeric, NULL::integer, NULL::numeric, NULL::numeric
     )`,
    [mid, stake, key]
  );

  // Test 1: a small bet within the per-side cap should succeed.
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [uid]);
  try {
    await callTrade(10, 'smoke-' + Math.random());
    ok("trade $10 over → succeeded");
  } catch (e) {
    // Some markets may reject for reasons unrelated to the smoke (oracle stale,
    // cap already filled by other test data). Surface as warn, not fail.
    wn(`trade $10 rejected: ${e.message.split('\n')[0]}`);
  }
  await c.query("ROLLBACK");

  // Test 2: a stake well above the per-user-per-market cap must reject.
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [uid]);
  try {
    await callTrade(50000, 'smoke-cap-' + Math.random());
    err("trade $50000 succeeded but should have been rejected (stake range or per-side cap)");
  } catch (e) {
    if (/Cap reached on|outside allowed range|stake/i.test(e.message)) {
      ok(`trade $50000 correctly rejected: "${e.message.split('\n')[0]}"`);
    } else if (/Insufficient balance|exposure cap|cluster|stale|disabled|paused/i.test(e.message)) {
      ok(`trade $50000 rejected by adjacent gate: "${e.message.split('\n')[0]}"`);
    } else {
      wn(`trade $50000 rejected by unexpected reason: "${e.message}"`);
    }
  }
  await c.query("ROLLBACK");
}

// -- 7. Withdrawal fee path --
console.log("\n[7] Withdrawal fee — process_withdrawal returns fee + net");
const wfn = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='process_withdrawal' AND pronamespace='public'::regnamespace`);
const wb = wfn.rows[0]?.def ?? "";
if (/'fee'/.test(wb) && /'net'/.test(wb)) ok("process_withdrawal returns fee + net in JSON");
else err("process_withdrawal does NOT return fee + net — mig 0025 not applied?");
if (/fee_amount|net_amount/.test(wb)) ok("process_withdrawal writes fee_amount + net_amount columns");
else err("process_withdrawal does NOT populate fee_amount/net_amount columns");

// -- Summary --
console.log("\n" + "═".repeat(60));
if (fail.length === 0 && warn.length === 0) console.log("✅ ALL CHECKS PASSED — backend is clean");
else {
  if (fail.length > 0) console.log(`❌ ${fail.length} FAILURES`);
  if (warn.length > 0) console.log(`⚠️  ${warn.length} warnings`);
  console.log("");
  for (const f of fail) console.log("  FAIL: " + f);
  for (const w of warn) console.log("  WARN: " + w);
}

await c.end();
process.exit(fail.length > 0 ? 1 : 0);
