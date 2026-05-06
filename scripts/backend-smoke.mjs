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

// -- 1. fee_config sanity --
console.log("\n[1] fee_config — values + types");
const cfg = await c.query(`SELECT fee_type, rate FROM fee_config ORDER BY fee_type`);
const byType = new Map(cfg.rows.map(r => [r.fee_type, Number(r.rate)]));
const required = [
  ["speed_stake_max_usd", 1, 10000000],
  ["speed_cap_per_side_usd", 1, 10000000],
  ["speed_max_user_daily_wager", 1, 10000000],
  ["speed_pool_collateral_usd", 1, 10000000],
  ["speed_max_market_exposure_pct", 0.01, 1.0],
  ["speed_max_strike_cluster_pct", 0.01, 1.0],
  ["speed_markets_enabled", 0, 1],
  ["speed_oracle_stale_seconds", 1, 60],
  ["withdrawal_fee", 0, 0.5],
];
for (const [k, lo, hi] of required) {
  const v = byType.get(k);
  if (v === undefined) err(`fee_config missing key: ${k}`);
  else if (v < lo || v > hi) err(`fee_config ${k} = ${v} outside expected [${lo}, ${hi}]`);
  else ok(`${k} = ${v}`);
}

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

// -- 3. speed_execute_trade reads new fee_config keys --
console.log("\n[3] speed_execute_trade — verify mig 0027 took effect");
const trade = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='speed_execute_trade' AND pronamespace='public'::regnamespace`);
const body = trade.rows[0]?.def ?? "";
if (body.includes("speed_stake_max_usd")) ok("RPC reads speed_stake_max_usd from fee_config");
else err("RPC does NOT read speed_stake_max_usd — mig 0027 not applied or got rolled back");
if (body.includes("speed_cap_per_side_usd")) ok("RPC reads speed_cap_per_side_usd from fee_config");
else err("RPC does NOT read speed_cap_per_side_usd");
if (/v_stake_max\s*DECIMAL\s*:=\s*25\.00/.test(body)) err("RPC still has hardcoded v_stake_max := 25.00");
else ok("RPC has no leftover hardcoded v_stake_max = 25.00");
if (/v_cap_per_side\s*DECIMAL\s*:=\s*200\.00/.test(body)) err("RPC still has hardcoded v_cap_per_side := 200.00");
else ok("RPC has no leftover hardcoded v_cap_per_side = 200.00");

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
console.log("\n[6] speed_execute_trade — gate behavior smoke test (rolled back)");
const userRow = await c.query(`SELECT id, balance_usd FROM users WHERE balance_usd > 100 ORDER BY balance_usd DESC LIMIT 1`);
const mkt = await c.query(`SELECT id FROM speed_markets WHERE status='open' AND duration='5m' AND closes_at > NOW() + INTERVAL '15 seconds' AND strike_price IS NOT NULL ORDER BY closes_at ASC LIMIT 1`);
if (userRow.rows.length === 0) wn("no funded user to dry-run trade RPC against; skipped");
else if (mkt.rows.length === 0) wn("no open 5m market with >15s left + finalized strike; skipped");
else {
  const uid = userRow.rows[0].id;
  const mid = mkt.rows[0].id;
  // Test 1: $25 should now succeed (used to be at the literal cap)
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [uid]);
  try {
    await c.query(`SELECT speed_execute_trade($1::uuid, 'over', 25, 'smoke-' || gen_random_uuid()::text, NULL)`, [mid]);
    ok("trade $25 over → succeeded (would have hit old $25 ceiling exactly; now well below new $1k cap)");
  } catch (e) {
    err(`trade $25 unexpectedly rejected: ${e.message}`);
  }
  await c.query("ROLLBACK");

  // Test 2: $1500 should fail with the new cap_per_side ($1000 cap, single bet > cap)
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [uid]);
  try {
    await c.query(`SELECT speed_execute_trade($1::uuid, 'over', 1500, 'smoke-cap-' || gen_random_uuid()::text, NULL)`, [mid]);
    err("trade $1500 succeeded but should have been rejected by per-side cap");
  } catch (e) {
    if (/Cap reached on .* side|outside allowed range/i.test(e.message)) {
      ok(`trade $1500 correctly rejected: "${e.message.split('\n')[0]}"`);
    } else if (/Insufficient balance|exposure cap|cluster|stale|disabled/i.test(e.message)) {
      ok(`trade $1500 rejected by adjacent gate: "${e.message.split('\n')[0]}"`);
    } else {
      wn(`trade $1500 rejected by unexpected reason: "${e.message}"`);
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
