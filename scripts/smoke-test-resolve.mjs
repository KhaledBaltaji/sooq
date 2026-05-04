// End-to-end smoke test for the speed-mode trade + cashout + resolve loop.
//
// Catches type-cast bugs, missing column references, NULL trip-wires, and
// any drift between what the trade RPC writes and what the resolve RPC
// expects to read. Designed to be the canary that would have caught the
// "operator does not exist: speed_side = text" silent failure in mig 0016.
//
// Use: node scripts/smoke-test-resolve.mjs
//
// Mutates staging — creates a throwaway test market with a 5-second close
// window, executes a $1 trade, waits for close, calls resolve, asserts
// the position settled correctly. Cleans up only on success; on failure
// leaves rows in place so you can inspect.
//
// Exits 0 on pass, 1 on any failure.
import { config } from "dotenv";
import pg from "pg";
import { randomUUID } from "crypto";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

let issues = 0;
const fail = (msg) => { issues += 1; console.log("⚠️  " + msg); };
const pass = (msg) => console.log("✓  " + msg);
const sec = (label) => console.log(`\n${"━".repeat(8)} ${label} ${"━".repeat(8)}`);

const SMOKE_EMAIL = `smoke-test-${Date.now()}@sooq.test`;
let userId = null;
let marketId = null;

try {
  sec("Setup — throwaway user with $50 balance");
  const u = await c.query(`
    INSERT INTO users (email, balance_usd, is_admin, locale)
    VALUES ($1, 50, false, 'en')
    RETURNING id
  `, [SMOKE_EMAIL]);
  userId = u.rows[0].id;
  pass(`created test user ${userId}`);

  sec("Setup — throwaway 5m market closing in 25 seconds (clears 10s late-window)");
  const oracle = await c.query(`SELECT price, received_at FROM speed_oracle_latest WHERE asset='BTC'`);
  if (oracle.rowCount === 0) throw new Error("no oracle price for BTC");
  const strikePrice = Number(oracle.rows[0].price);
  pass(`current BTC price: ${strikePrice}`);

  // Set strike $100 below oracle so 'over' wins on a normal market move.
  // closes_at = NOW + 25s so the bet clears the 10s late-window check, the
  // market resolves shortly after the wait, and the test still finishes
  // in well under a minute. opens_at is in the past for the strike-tick
  // lookup to find a tick at-or-before opens_at (mig 0014 path).
  const offsetStrike = (strikePrice - 100).toFixed(8);
  const m = await c.query(`
    INSERT INTO speed_markets (asset, duration, strike_price, opens_at, closes_at, status)
    VALUES ('BTC', '5m'::speed_duration, $1::decimal, NOW() - INTERVAL '4 minutes 35 seconds', NOW() + INTERVAL '25 seconds', 'open')
    RETURNING id
  `, [offsetStrike]);
  marketId = m.rows[0].id;
  pass(`created throwaway market ${marketId} strike=${offsetStrike} (current price ${strikePrice} → expected outcome=over)`);

  sec("Step 1 — execute_trade: $1 on 'over'");
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  const idemKey = `smoke-${randomUUID()}`;
  const tradeRes = await c.query(`
    SELECT speed_execute_trade($1::uuid, 'over', 1::numeric, $2::text, NULL) AS r
  `, [marketId, idemKey]);
  await c.query("COMMIT");
  const trade = tradeRes.rows[0].r;
  console.log("trade result:", JSON.stringify(trade));
  if (!trade.success) { fail("execute_trade did not return success"); throw new Error("trade failed"); }
  pass(`trade succeeded: position_id=${trade.position_id}, offered_prob=${trade.offered_prob}, payout_if_won=${trade.payout_if_won}`);

  sec("Step 2 — wait for market to close (~28s)");
  await new Promise((r) => setTimeout(r, 28000));
  pass("woken up — market should be past close");

  sec("Step 3 — call speed_resolve_market directly");
  const resolveRes = await c.query(`SELECT speed_resolve_market($1::uuid) AS r`, [marketId]);
  let resolve = resolveRes.rows[0].r;
  console.log("resolve result:", JSON.stringify(resolve, null, 2));

  // Race with pg_cron: it runs every 5s and may have already resolved this
  // market between our 28s wait and our manual call. If skipped because the
  // market is already 'resolved' or 'voided', read the final state from the
  // market row directly — that is just as good a signal.
  if (resolve.skipped) {
    const m = await c.query(`SELECT status::TEXT, outcome::TEXT, twap_at_close::numeric FROM speed_markets WHERE id = $1`, [marketId]);
    if (m.rowCount === 0) { fail("market vanished after resolve skip"); throw new Error("no market"); }
    const mr = m.rows[0];
    if (mr.status === 'resolved') {
      resolve = { success: true, voided: false, outcome: mr.outcome, settlement_price: mr.twap_at_close };
      pass(`cron resolved before us: outcome=${mr.outcome}, settlement=${mr.twap_at_close}`);
    } else if (mr.status === 'voided') {
      resolve = { success: true, voided: true, reason: 'voided by cron' };
      pass("cron voided before us");
    } else {
      fail(`resolve skipped but market not in terminal state: ${mr.status}`);
      throw new Error("resolve unresolvable");
    }
  } else if (!resolve.success) {
    fail(`resolve did not return success: ${JSON.stringify(resolve)}`);
    throw new Error("resolve failed");
  } else if (resolve.voided) {
    fail(`market was voided: ${resolve.reason}`);
  } else {
    pass(`resolved: outcome=${resolve.outcome}, settlement=${resolve.settlement_price}, winners=${resolve.winners}, losers=${resolve.losers}`);
  }

  sec("Step 4 — assert position state");
  const pos = await c.query(`
    SELECT p.status::TEXT AS status, p.payout_amount::numeric AS payout,
           p.entry_offered_prob::numeric AS entry, p.stake::numeric AS stake,
           ROUND(p.stake / NULLIF(p.entry_offered_prob, 0), 2)::numeric AS expected_payout
    FROM speed_positions p WHERE p.user_id = $1 AND p.market_id = $2
  `, [userId, marketId]);
  if (pos.rowCount === 0) { fail("no position found post-resolve"); throw new Error("no position"); }
  const p = pos.rows[0];
  console.log(`position: status=${p.status}, payout=${p.payout}, expected_if_won=${p.expected_payout}`);

  if (resolve.outcome === 'over') {
    if (p.status !== 'won') fail(`expected status='won', got '${p.status}'`);
    else pass("position correctly marked 'won'");
    const diff = Math.abs(Number(p.payout) - Number(p.expected_payout));
    if (diff > 0) fail(`payout ${p.payout} != expected ${p.expected_payout} (diff $${diff})`);
    else pass(`payout matches stake/entry_offered_prob exactly: $${p.payout}`);
  } else if (resolve.outcome === 'at_strike') {
    if (p.status !== 'refunded') fail(`expected status='refunded' for at_strike, got '${p.status}'`);
    else if (Math.abs(Number(p.payout) - Number(p.stake)) > 0) fail(`refund != stake`);
    else pass("at_strike push refund correct");
  } else {
    if (p.status !== 'lost') fail(`expected status='lost' for outcome=${resolve.outcome}, got '${p.status}'`);
    else if (Number(p.payout || 0) !== 0) fail(`lost payout != 0`);
    else pass("lost path correct");
  }

  sec("Step 5 — assert balance + transaction ledger");
  const ledger = await c.query(`
    SELECT type::TEXT AS type, amount::numeric AS amount, balance_after::numeric AS balance_after
    FROM transactions WHERE user_id = $1 ORDER BY created_at ASC
  `, [userId]);
  console.table(ledger.rows.map(r => ({ type: r.type, amount: Number(r.amount), balance_after: Number(r.balance_after) })));
  const stakeTx = ledger.rows.find(r => r.type === 'speed_stake');
  if (!stakeTx) fail("no speed_stake transaction");
  else if (Number(stakeTx.amount) !== -1) fail(`speed_stake amount expected -1, got ${stakeTx.amount}`);
  else pass("speed_stake tx written with amount -$1");

  if (resolve.outcome === 'over') {
    const payoutTx = ledger.rows.find(r => r.type === 'speed_payout');
    if (!payoutTx) fail("no speed_payout transaction");
    else if (Math.abs(Number(payoutTx.amount) - Number(p.expected_payout)) > 0) {
      fail(`speed_payout amount ${payoutTx.amount} != expected ${p.expected_payout}`);
    } else pass(`speed_payout tx correct: $${payoutTx.amount}`);
  }

  const finalBal = await c.query(`SELECT balance_usd::numeric AS b FROM users WHERE id = $1`, [userId]);
  const txSum = ledger.rows.reduce((acc, r) => acc + Number(r.amount), 0);
  console.log(`final balance: $${finalBal.rows[0].b}, ledger sum (excl. seed): $${txSum.toFixed(2)}, expected balance: $${(50 + txSum).toFixed(2)}`);
  if (Math.abs(Number(finalBal.rows[0].b) - (50 + txSum)) > 0.01) {
    fail("balance does not equal 50 + sum(transactions)");
  } else pass("balance reconciles with ledger");

} catch (e) {
  console.log(`\n💥 smoke test threw: ${e.message}`);
  issues += 1;
} finally {
  // Clean up only on success — leave evidence on failure.
  if (issues === 0) {
    sec("Cleanup");
    if (marketId) {
      await c.query(`DELETE FROM speed_settlements WHERE market_id = $1`, [marketId]);
      await c.query(`DELETE FROM speed_market_settlement_audit WHERE market_id = $1`, [marketId]);
      await c.query(`DELETE FROM speed_trades WHERE market_id = $1`, [marketId]);
      await c.query(`DELETE FROM speed_positions WHERE market_id = $1`, [marketId]);
      await c.query(`DELETE FROM speed_markets WHERE id = $1`, [marketId]);
    }
    if (userId) {
      await c.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    pass("test rows cleaned up");
  } else {
    console.log(`\nLeft behind for inspection: user=${userId} market=${marketId}`);
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log(`Smoke test: ${issues === 0 ? "✅ PASS" : `⚠️  ${issues} FAILURES`}`);
console.log(`${"═".repeat(60)}`);

await c.end();
process.exit(issues === 0 ? 0 : 1);
