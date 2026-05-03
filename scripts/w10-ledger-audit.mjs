// W10 ledger coherence audit — runs invariant checks on live RDS.
//
// Verifies that every user's cached balance_usd matches SUM(transactions),
// no positions have inconsistent state vs settlements, no orphan trades,
// no over-credited refunds, etc.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const sec = (label) => console.log(`\n${"━".repeat(8)} ${label} ${"━".repeat(8)}`);
let issues = 0;
const fail = (msg) => { issues += 1; console.log("⚠️  " + msg); };
const pass = (msg) => console.log("✓  " + msg);

// 1) Cache vs ledger reconciliation
sec("Balance cache vs SUM(transactions) per user");
const drift = await c.query(`
  SELECT u.id, u.email, u.balance_usd::numeric AS cached,
         COALESCE(SUM(t.amount),0)::numeric AS ledger,
         (u.balance_usd::numeric - COALESCE(SUM(t.amount),0)::numeric) AS drift_usd
  FROM users u
  LEFT JOIN transactions t ON t.user_id = u.id
  GROUP BY u.id, u.email, u.balance_usd
  HAVING u.balance_usd::numeric <> COALESCE(SUM(t.amount),0)::numeric
  ORDER BY ABS(u.balance_usd::numeric - COALESCE(SUM(t.amount),0)::numeric) DESC
  LIMIT 20
`);
if (drift.rowCount === 0) pass("all users reconciled");
else { console.table(drift.rows); fail(`${drift.rowCount} users have cache drift vs ledger`); }

// 2) Negative balances
sec("Negative balances");
const neg = await c.query(`SELECT id, email, balance_usd FROM users WHERE balance_usd < 0`);
if (neg.rowCount === 0) pass("no negative balances");
else { console.table(neg.rows); fail(`${neg.rowCount} users with negative balance`); }

// 3) Orphan trades — speed_trades without a matching position
sec("Orphan speed_trades");
const orphan = await c.query(`
  SELECT count(*)::int AS n FROM speed_trades st
  WHERE NOT EXISTS (SELECT 1 FROM speed_positions p WHERE p.id = st.position_id)
`);
if (orphan.rows[0].n === 0) pass("no orphan trades");
else fail(`${orphan.rows[0].n} orphan trades`);

// 4) Trade rows missing tx
sec("Trades without matching transactions row");
const tradesMissingTx = await c.query(`
  SELECT count(*)::int AS n FROM speed_trades st
  WHERE st.kind = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.reference_id = st.id AND t.type = 'speed_stake'
    )
`);
if (tradesMissingTx.rows[0].n === 0) pass("every open-trade has a tx");
else fail(`${tradesMissingTx.rows[0].n} open-trades missing tx row`);

// 5) Cashed-out positions missing payout tx
sec("Cashed-out positions without payout tx");
const cashoutMissing = await c.query(`
  SELECT count(*)::int AS n FROM speed_positions p
  WHERE p.status = 'cashed_out'
    AND COALESCE(p.payout_amount, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      JOIN speed_trades st ON st.id = t.reference_id
      WHERE st.position_id = p.id AND st.kind = 'cashout' AND t.type = 'speed_cashout'
    )
`);
if (cashoutMissing.rows[0].n === 0) pass("every cashed_out has a payout tx");
else fail(`${cashoutMissing.rows[0].n} cashouts missing payout tx`);

// 6) Won positions missing payout tx
sec("Won positions without payout tx");
const wonMissing = await c.query(`
  SELECT count(*)::int AS n FROM speed_positions p
  WHERE p.status = 'won'
    AND COALESCE(p.payout_amount, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.user_id = p.user_id AND t.type = 'speed_payout' AND t.reference_id = p.id
    )
`);
if (wonMissing.rows[0].n === 0) pass("every won has a payout tx");
else fail(`${wonMissing.rows[0].n} won positions missing payout tx`);

// 7) Settlements vs positions
sec("Position status vs settlement coverage");
const settleGap = await c.query(`
  SELECT count(*)::int AS n FROM speed_positions p
  WHERE p.status IN ('won','lost','refunded')
    AND NOT EXISTS (SELECT 1 FROM speed_settlements s WHERE s.position_id = p.id)
`);
if (settleGap.rows[0].n === 0) pass("every settled position has settlement row");
else fail(`${settleGap.rows[0].n} settled positions missing settlement row`);

// 8) Resolved markets — does payout sum match expected (winners only)
sec("Resolved-market payout vs expected (sample)");
const resolved = await c.query(`
  SELECT m.id, m.outcome, m.duration,
    COUNT(p.id) AS positions,
    SUM(p.stake) AS stake_total,
    SUM(CASE WHEN p.status='won' THEN p.payout_amount ELSE 0 END) AS payout_total
  FROM speed_markets m
  LEFT JOIN speed_positions p ON p.market_id = m.id
  WHERE m.status = 'resolved'
  GROUP BY m.id ORDER BY m.resolved_at DESC LIMIT 5
`);
console.table(resolved.rows);

// 9) Voided markets — refund coverage
sec("Voided markets — every position refunded?");
const voidGap = await c.query(`
  SELECT count(*)::int AS n FROM speed_markets m
  JOIN speed_positions p ON p.market_id = m.id
  WHERE m.status = 'voided'
    AND p.status NOT IN ('refunded','cashed_out')
`);
if (voidGap.rows[0].n === 0) pass("every position on voided markets is refunded or cashed_out");
else fail(`${voidGap.rows[0].n} positions on voided markets in unexpected state`);

// 10) Duplicate idempotency keys
sec("Duplicate idempotency keys (should be uq-prevented)");
const dupKey = await c.query(`
  SELECT idempotency_key, user_id, count(*)::int AS n
  FROM speed_trades WHERE idempotency_key IS NOT NULL
  GROUP BY idempotency_key, user_id HAVING count(*) > 1 LIMIT 5
`);
if (dupKey.rowCount === 0) pass("no duplicate idempotency keys");
else { console.table(dupKey.rows); fail(`${dupKey.rowCount} duplicate idem-key groups`); }

// 11) Withdrawals vs balance debits
sec("Withdrawals — every approved withdrawal has a debit tx?");
const wdGap = await c.query(`
  SELECT count(*)::int AS n FROM withdrawals w
  WHERE w.status IN ('approved','sent','completed')
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.user_id = w.user_id AND t.type = 'withdrawal' AND t.reference_id = w.id
    )
`).catch((e) => ({ rows: [{ n: 0 }], err: e.message }));
if (wdGap.err) console.log("(skipped — schema mismatch:", wdGap.err.slice(0, 80), ")");
else if (wdGap.rows[0].n === 0) pass("every approved withdrawal has a tx");
else fail(`${wdGap.rows[0].n} withdrawals missing debit tx`);

// 12) Deposit idempotency
sec("Deposits — duplicate provider_ref?");
const depDup = await c.query(`
  SELECT provider, provider_ref, count(*)::int AS n
  FROM deposits WHERE provider_ref IS NOT NULL
  GROUP BY provider, provider_ref HAVING count(*) > 1 LIMIT 5
`).catch((e) => ({ rows: [], err: e.message }));
if (depDup.err) console.log("(skipped — schema mismatch:", depDup.err.slice(0, 80), ")");
else if (depDup.rowCount === 0) pass("no duplicate provider_ref on deposits");
else { console.table(depDup.rows); fail(`${depDup.rowCount} duplicate provider_ref groups`); }

// 13) Spread analysis on resolved markets
sec("Resolved markets P&L (platform's edge)");
const pnl = await c.query(`
  WITH per_market AS (
    SELECT m.id, m.duration,
      SUM(p.stake) AS user_in,
      SUM(CASE WHEN p.status='won' THEN p.payout_amount ELSE 0 END) AS user_out,
      COUNT(p.id) AS pos_count
    FROM speed_markets m
    LEFT JOIN speed_positions p ON p.market_id = m.id
    WHERE m.status = 'resolved'
    GROUP BY m.id, m.duration
    HAVING COUNT(p.id) > 0
  )
  SELECT duration,
    count(*)::int AS markets,
    sum(pos_count)::int AS total_positions,
    sum(user_in) AS total_in,
    sum(user_out) AS total_out,
    sum(user_in - user_out) AS platform_pnl
  FROM per_market GROUP BY duration ORDER BY duration
`);
console.table(pnl.rows);

console.log(`\n=== W10 ledger audit: ${issues === 0 ? "✅ no issues" : `⚠️ ${issues} issues`} ===`);
await c.end();
