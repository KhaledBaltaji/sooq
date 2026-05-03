// W9 — speed_execute_trade end-to-end invariant suite.
//
// Exercises every guard in the trade RPC against the live RDS staging
// instance. Each test runs in its own pg client so the `app.user_id`
// GUC + transaction state stay isolated between cases.
//
// Tests covered:
//   T0 — environment probe (open market exists, oracle fresh, fee_config rows)
//   T1 — master switch OFF → trade rejects (toggles speed_markets_enabled,
//        verifies rejection, restores)
//   T2 — TWAP oracle freshness gate: forces stale received_at via in-tx
//        UPDATE, expects "Oracle price stale" rejection, ROLLBACK keeps the
//        worker pipeline clean.
//   T3 — happy path: $5 over @ market spot succeeds, balance debited,
//        speed_positions + speed_trades + transactions rows written
//   T4 — idempotency: re-issuing the same idempotency_key returns the same
//        position_id without a second debit
//   T5 — stake below min ($0.50) rejects
//   T6 — stake above max ($30) rejects
//   T7 — per-side cap: opens enough $25 positions to fill the $200 over cap,
//        then verifies the 9th is rejected with "Cap reached on over side"
//   T8 — cashout on the first open position succeeds, position transitions to
//        cashed_out, balance credited.
//
// Cleanup is light — the script leaves the test user in place so a re-run is
// idempotent. Pass --reset to nuke the user's open positions before starting.
//
// Run:   node scripts/w9-trade-suite.mjs
//        node scripts/w9-trade-suite.mjs --reset
import { config } from "dotenv";
import pg from "pg";
import crypto from "crypto";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const RESET = process.argv.includes("--reset");
const TEST_EMAIL = "w9-trade-suite@sooq.test";

let totalPass = 0;
let totalFail = 0;

function pass(name, extra = "") {
  totalPass += 1;
  console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ""}`);
}
function fail(name, err) {
  totalFail += 1;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌ ${name} — ${msg}`);
}

function makePool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
}

// --- helpers --------------------------------------------------------------

async function asUser(pool, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function asUserExpectError(pool, userId, fn, fragment) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    try {
      await fn(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (fragment && !msg.toLowerCase().includes(fragment.toLowerCase())) {
        throw new Error(
          `expected error containing "${fragment}", got: ${msg}`
        );
      }
      await client.query("ROLLBACK").catch(() => {});
      return msg;
    }
    throw new Error("expected RPC to throw, but it returned");
  } finally {
    client.release();
  }
}

// --- main -----------------------------------------------------------------

const pool = makePool();

// T0 — environment probe
console.log("\nT0 — environment probe");
let testUserId;
let openMarket;
{
  const oracle = await pool.query(
    "SELECT asset, price, received_at, EXTRACT(EPOCH FROM (NOW() - received_at)) AS age_sec FROM speed_oracle_latest WHERE asset = 'BTC'"
  );
  if (!oracle.rows.length) {
    console.log("  ❌ no BTC oracle row — start the worker first");
    process.exit(1);
  }
  const row = oracle.rows[0];
  if (row.age_sec > 5) {
    console.log(`  ❌ oracle stale (age ${row.age_sec}s) — start worker first`);
    process.exit(1);
  }
  pass(
    "oracle live",
    `BTC=$${Number(row.price).toFixed(2)} age=${Number(row.age_sec).toFixed(2)}s`
  );

  const fees = await pool.query(
    "SELECT fee_type, rate FROM fee_config WHERE fee_type IN ('speed_markets_enabled','speed_oracle_stale_seconds','speed_handle_fee_pct','speed_spread_pct','speed_iv_btc') ORDER BY fee_type"
  );
  const haveFees = new Map(fees.rows.map((r) => [r.fee_type, r.rate]));
  for (const need of [
    "speed_markets_enabled",
    "speed_oracle_stale_seconds",
    "speed_handle_fee_pct",
    "speed_spread_pct",
    "speed_iv_btc",
  ]) {
    if (haveFees.has(need)) pass(`fee_config.${need} = ${haveFees.get(need)}`);
    else fail(`fee_config.${need}`, new Error("missing"));
  }
  if (haveFees.get("speed_markets_enabled") === "0") {
    console.log("  ⚠️  speed_markets_enabled is 0 — enabling for the test run");
    await pool.query(
      "UPDATE fee_config SET rate = 1 WHERE fee_type = 'speed_markets_enabled'"
    );
  }

  // Try currently-active market first.
  const market = await pool.query(
    "SELECT id, asset, duration, opens_at, closes_at, EXTRACT(EPOCH FROM (closes_at - NOW())) AS seconds_left FROM speed_markets WHERE status='open' AND opens_at <= NOW() AND closes_at > NOW() ORDER BY closes_at ASC LIMIT 1"
  );
  if (market.rows.length) {
    openMarket = market.rows[0];
    pass(
      "open market (existing)",
      `${openMarket.duration} ${openMarket.id} closes_at=${openMarket.closes_at.toISOString()} (${Number(openMarket.seconds_left).toFixed(0)}s left)`
    );
  } else {
    // No active market right now — known finding: pg_cron's roll uses
    // strictly-future boundaries, leaving a 5-minute gap after each 5m
    // resolution. Insert a test market so the suite can run regardless.
    const inserted = await pool.query(
      `INSERT INTO speed_markets (asset, duration, strike_price, opens_at, closes_at, status)
       SELECT 'BTC', '5m'::speed_duration, price, NOW() - INTERVAL '5 seconds', NOW() + INTERVAL '5 minutes', 'open'
       FROM speed_oracle_latest WHERE asset = 'BTC'
       RETURNING id, asset, duration, opens_at, closes_at, EXTRACT(EPOCH FROM (closes_at - NOW())) AS seconds_left`
    );
    openMarket = inserted.rows[0];
    pass(
      "open market (test-injected)",
      `${openMarket.duration} ${openMarket.id} ephemeral 5m for the suite`
    );
  }

  let user = await pool.query(
    "SELECT id, balance_usd FROM users WHERE email = $1",
    [TEST_EMAIL]
  );
  if (!user.rows.length) {
    user = await pool.query(
      "INSERT INTO users (email, name, balance_usd) VALUES ($1, $2, $3) RETURNING id, balance_usd",
      [TEST_EMAIL, "W9 Trade Suite", 500]
    );
    pass(`test user created — id=${user.rows[0].id}, balance=$500`);
  } else {
    if (Number(user.rows[0].balance_usd) < 300) {
      await pool.query(
        "UPDATE users SET balance_usd = 500 WHERE email = $1",
        [TEST_EMAIL]
      );
      pass(`test user reset to $500`);
    } else {
      pass(
        `test user reused — id=${user.rows[0].id}, balance=$${user.rows[0].balance_usd}`
      );
    }
  }
  testUserId = user.rows[0].id;

  if (RESET) {
    // speed_position_status has no 'voided' (only on markets) — use
    // 'refunded' to signal the position was cleared without P&L.
    const cleared = await pool.query(
      `UPDATE speed_positions SET status = 'refunded'
       WHERE user_id = $1 AND status = 'open' RETURNING id`,
      [testUserId]
    );
    pass(`--reset: refunded ${cleared.rowCount} prior open positions`);
  }
}

// T1 — master switch off
console.log("\nT1 — master kill switch");
{
  await pool.query(
    "UPDATE fee_config SET rate = 0 WHERE fee_type = 'speed_markets_enabled'"
  );
  try {
    await asUserExpectError(
      pool,
      testUserId,
      (c) =>
        c.query(
          "SELECT speed_execute_trade($1::uuid, 'over', 5, $2)",
          [openMarket.id, `w9-killswitch-${Date.now()}`]
        ),
      "disabled"
    );
    pass("kill switch rejects trade");
  } catch (err) {
    fail("kill switch rejects trade", err);
  } finally {
    await pool.query(
      "UPDATE fee_config SET rate = 1 WHERE fee_type = 'speed_markets_enabled'"
    );
  }
}

// T2 — TWAP oracle freshness gate
console.log("\nT2 — TWAP oracle freshness gate");
{
  // Strategy: BEGIN tx, UPDATE oracle_latest received_at to 5s ago. The
  // UPDATE takes a row lock so the worker can't overwrite it mid-test. Call
  // the RPC in the same tx — its `SELECT * FROM speed_oracle_latest`
  // observes our local row version. ROLLBACK at the end so the row reverts
  // and the worker keeps writing.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [testUserId]);
    await client.query(
      "UPDATE speed_oracle_latest SET received_at = NOW() - INTERVAL '5 seconds' WHERE asset = 'BTC'"
    );
    try {
      await client.query(
        "SELECT speed_execute_trade($1::uuid, 'over', 5, $2)",
        [openMarket.id, `w9-stale-${Date.now()}`]
      );
      fail("stale oracle rejects trade", new Error("RPC accepted the trade"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("oracle price stale")) {
        pass("stale oracle rejects trade", `error: ${msg}`);
      } else {
        fail("stale oracle rejects trade", err);
      }
    }
    await client.query("ROLLBACK").catch(() => {});
  } finally {
    client.release();
  }
}

// T3 — happy path
console.log("\nT3 — happy path trade");
let firstPositionId;
{
  const before = await pool.query(
    "SELECT balance_usd FROM users WHERE id = $1",
    [testUserId]
  );
  const beforeBalance = Number(before.rows[0].balance_usd);
  try {
    const result = await asUser(pool, testUserId, (c) =>
      c.query(
        "SELECT speed_execute_trade($1::uuid, 'over', 5, $2) AS r",
        [openMarket.id, `w9-happy-${Date.now()}`]
      )
    );
    const r = result.rows[0].r;
    if (!r.success) throw new Error(`expected success, got ${JSON.stringify(r)}`);
    firstPositionId = r.position_id;
    pass(
      "happy trade",
      `position=${r.position_id} offered_prob=${r.offered_prob} spot=$${r.spot_price}`
    );

    const after = await pool.query(
      "SELECT balance_usd FROM users WHERE id = $1",
      [testUserId]
    );
    const afterBalance = Number(after.rows[0].balance_usd);
    if (Math.abs(beforeBalance - afterBalance - 5) < 0.001) {
      pass("balance debited $5 exactly", `${beforeBalance} → ${afterBalance}`);
    } else {
      fail(
        "balance debited $5 exactly",
        new Error(`got ${beforeBalance} → ${afterBalance}`)
      );
    }

    const txs = await pool.query(
      "SELECT type, amount, balance_after FROM transactions WHERE reference_id = (SELECT id FROM speed_trades WHERE position_id = $1::uuid LIMIT 1)",
      [firstPositionId]
    );
    if (txs.rows.length === 1 && txs.rows[0].type === "speed_stake") {
      pass(
        "transactions row written",
        `type=speed_stake amount=$${txs.rows[0].amount}`
      );
    } else {
      fail(
        "transactions row written",
        new Error(`got ${JSON.stringify(txs.rows)}`)
      );
    }
  } catch (err) {
    fail("happy trade", err);
  }
}

// T4 — idempotency
console.log("\nT4 — idempotency key");
if (firstPositionId) {
  const idemKey = `w9-idem-${Date.now()}-${crypto.randomUUID()}`;
  let firstId;
  try {
    const r1 = await asUser(pool, testUserId, (c) =>
      c.query(
        "SELECT speed_execute_trade($1::uuid, 'over', 5, $2) AS r",
        [openMarket.id, idemKey]
      )
    );
    firstId = r1.rows[0].r.position_id;
    pass(`first call — position=${firstId}`);

    const r2 = await asUser(pool, testUserId, (c) =>
      c.query(
        "SELECT speed_execute_trade($1::uuid, 'over', 5, $2) AS r",
        [openMarket.id, idemKey]
      )
    );
    const r2body = r2.rows[0].r;
    if (r2body.idempotent && r2body.position_id === firstId) {
      pass("second call returned same position_id (idempotent)");
    } else {
      fail(
        "second call returned same position_id",
        new Error(`got ${JSON.stringify(r2body)}`)
      );
    }
  } catch (err) {
    fail("idempotency", err);
  }
}

// T5 — stake too small
console.log("\nT5 — stake below min");
{
  try {
    await asUserExpectError(
      pool,
      testUserId,
      (c) =>
        c.query(
          "SELECT speed_execute_trade($1::uuid, 'over', 0.5, $2)",
          [openMarket.id, `w9-min-${Date.now()}`]
        ),
      "outside allowed range"
    );
    pass("stake $0.50 rejects");
  } catch (err) {
    fail("stake $0.50 rejects", err);
  }
}

// T6 — stake too large
console.log("\nT6 — stake above max");
{
  try {
    await asUserExpectError(
      pool,
      testUserId,
      (c) =>
        c.query(
          "SELECT speed_execute_trade($1::uuid, 'over', 30, $2)",
          [openMarket.id, `w9-max-${Date.now()}`]
        ),
      "outside allowed range"
    );
    pass("stake $30 rejects");
  } catch (err) {
    fail("stake $30 rejects", err);
  }
}

// T7 — per-side cap
console.log("\nT7 — per-side cap saturation");
{
  // The user has ~$5+5+5 = $15 already on 'over' from T3+T4. Cap is $200.
  // Top up balance + add until the next $25 trips the cap. Pick a fresh
  // market to avoid the closes_at race during the loop.
  try {
    await pool.query("UPDATE users SET balance_usd = 500 WHERE id = $1", [
      testUserId,
    ]);

    // Find current 'over' exposure on this market
    const cur = await pool.query(
      "SELECT COALESCE(SUM(stake), 0)::numeric AS s FROM speed_positions WHERE user_id = $1 AND market_id = $2 AND side = 'over' AND status = 'open'",
      [testUserId, openMarket.id]
    );
    let overSum = Number(cur.rows[0].s);
    const remaining = 200 - overSum;

    // Fill in $25 chunks while there's headroom
    const chunkCount = Math.floor(remaining / 25);
    for (let i = 0; i < chunkCount; i++) {
      await asUser(pool, testUserId, (c) =>
        c.query(
          "SELECT speed_execute_trade($1::uuid, 'over', 25, $2) AS r",
          [openMarket.id, `w9-cap-fill-${i}-${Date.now()}`]
        )
      );
      overSum += 25;
    }
    pass(`filled to $${overSum} of $200 cap with ${chunkCount} × $25 trades`);

    // Next $25 must reject
    await asUserExpectError(
      pool,
      testUserId,
      (c) =>
        c.query(
          "SELECT speed_execute_trade($1::uuid, 'over', 25, $2)",
          [openMarket.id, `w9-cap-trip-${Date.now()}`]
        ),
      "cap reached"
    );
    pass("cap-trip $25 rejects");
  } catch (err) {
    fail("cap saturation", err);
  }
}

// T8 — cashout
console.log("\nT8 — cashout");
{
  try {
    const open = await pool.query(
      "SELECT id FROM speed_positions WHERE user_id = $1 AND status = 'open' ORDER BY created_at ASC LIMIT 1",
      [testUserId]
    );
    if (!open.rows.length) {
      fail("cashout", new Error("no open position to cash out"));
    } else {
      const positionId = open.rows[0].id;
      const before = await pool.query(
        "SELECT balance_usd FROM users WHERE id = $1",
        [testUserId]
      );
      const result = await asUser(pool, testUserId, (c) =>
        c.query(
          "SELECT speed_execute_cashout($1::uuid, $2) AS r",
          [positionId, `w9-cashout-${Date.now()}`]
        )
      );
      const r = result.rows[0].r;
      if (!r.success) throw new Error(`expected success, got ${JSON.stringify(r)}`);
      const after = await pool.query(
        "SELECT balance_usd FROM users WHERE id = $1",
        [testUserId]
      );
      const credited = Number(after.rows[0].balance_usd) - Number(before.rows[0].balance_usd);
      pass(
        "cashout returned",
        `position=${positionId} credit=$${credited.toFixed(4)} payout=$${r.payout}`
      );

      const status = await pool.query(
        "SELECT status FROM speed_positions WHERE id = $1",
        [positionId]
      );
      if (status.rows[0].status === "cashed_out") {
        pass("position transitioned to cashed_out");
      } else {
        fail(
          "position transitioned to cashed_out",
          new Error(`got status=${status.rows[0].status}`)
        );
      }
    }
  } catch (err) {
    fail("cashout", err);
  }
}

await pool.end();

console.log(
  `\n=== W9 trade suite: ${totalPass} pass / ${totalFail} fail ===`
);
process.exit(totalFail > 0 ? 1 : 0);
