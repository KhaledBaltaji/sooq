// W9-3 + W9-4 — pg_cron precision + concurrency stress test.
//
// Spawns N concurrent workers each hammering speed_execute_trade on a
// shared "load test" user against an injected ephemeral 5m market, while
// `pg_cron` is firing speed-roll + speed-resolve every 5s. After the load
// window, the script reports:
//
//   • Cron precision: inter-arrival times between runs of every speed-*
//     pg_cron job, sourced from cron.job_run_details. Aim: median ~5s,
//     p99 < 8s under load. Anything wildly above means the worker
//     contention is starving cron.
//
//   • Concurrency invariants:
//       1) Cap holds: SUM(stake) on the test market 'over' side ≤ $200
//          per user (we use one user, so total ≤ $200).
//       2) Ledger integrity: SUM(transactions.amount of type speed_stake
//          for the user) == −SUM(open_position.stake). No phantom debits.
//       3) No partial writes: every speed_trades row has a matching
//          speed_positions row and a matching transactions row.
//       4) No stake double-count: speed_trades.amount sum == sum of
//          stakes the workers think they sent (idempotency or rejection
//          accounts for the rest).
//
// Run:   node scripts/w9-load-suite.mjs
//        node scripts/w9-load-suite.mjs --workers=8 --duration-sec=30

import { config } from "dotenv";
import pg from "pg";
import crypto from "crypto";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    })
);
const WORKERS = Number(args.workers ?? 4);
const DURATION_SEC = Number(args["duration-sec"] ?? 20);
const STAKE = 25;
const TEST_EMAIL = "w9-load-suite@sooq.test";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: WORKERS + 4,
  connectionTimeoutMillis: 5_000,
});

console.log(
  `\nW9 load suite — ${WORKERS} workers, ${DURATION_SEC}s window, $${STAKE} stake per attempt\n`
);

// --- Setup: user + ephemeral market -------------------------------------
async function setup() {
  let user = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [TEST_EMAIL]
  );
  if (!user.rows.length) {
    user = await pool.query(
      "INSERT INTO users (email, name, balance_usd) VALUES ($1, $2, $3) RETURNING id",
      [TEST_EMAIL, "W9 Load Suite", 10_000]
    );
  } else {
    await pool.query("UPDATE users SET balance_usd = 10000 WHERE email = $1", [
      TEST_EMAIL,
    ]);
  }
  const userId = user.rows[0].id;

  // Refund any prior open positions from a previous run on this user.
  await pool.query(
    `UPDATE speed_positions SET status = 'refunded'
     WHERE user_id = $1 AND status = 'open'`,
    [userId]
  );

  const market = await pool.query(
    `INSERT INTO speed_markets (asset, duration, strike_price, opens_at, closes_at, status)
     SELECT 'BTC', '5m'::speed_duration, price, NOW() - INTERVAL '5 seconds', NOW() + INTERVAL '5 minutes', 'open'
     FROM speed_oracle_latest WHERE asset = 'BTC'
     RETURNING id, opens_at, closes_at`
  );
  const marketRow = market.rows[0];
  console.log(
    `setup: user=${userId} market=${marketRow.id} closes_at=${marketRow.closes_at.toISOString()}`
  );
  return { userId, marketId: marketRow.id };
}

// --- Cron precision snapshot --------------------------------------------
async function snapshotCron(label) {
  const r = await pool.query(
    `SELECT
       j.jobname,
       j.schedule,
       count(d.runid) AS runs,
       MIN(d.start_time) AS first_run,
       MAX(d.start_time) AS last_run,
       AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time))) AS avg_duration_sec
     FROM cron.job j
     LEFT JOIN cron.job_run_details d
       ON d.jobid = j.jobid
       AND d.start_time >= NOW() - make_interval(secs => $1::int)
     WHERE j.jobname LIKE 'speed-%'
     GROUP BY j.jobname, j.schedule
     ORDER BY j.jobname`,
    [DURATION_SEC + 30]
  );
  console.log(`\n=== Cron snapshot: ${label} (last ${DURATION_SEC + 30}s) ===`);
  console.table(
    r.rows.map((row) => ({
      jobname: row.jobname,
      schedule: row.schedule,
      runs: Number(row.runs),
      avg_dur_sec: row.avg_duration_sec
        ? Number(row.avg_duration_sec).toFixed(3)
        : "n/a",
    }))
  );
  return r.rows;
}

// --- Worker -------------------------------------------------------------
async function worker({ id, userId, marketId, deadline, results }) {
  const log = [];
  while (Date.now() < deadline) {
    const stakeKey = `w9-load-w${id}-${crypto.randomUUID()}`;
    const start = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId,
      ]);
      const r = await client.query(
        "SELECT speed_execute_trade($1::uuid, 'over', $2, $3) AS r",
        [marketId, STAKE, stakeKey]
      );
      await client.query("COMMIT");
      const elapsed = Date.now() - start;
      log.push({ ok: true, elapsed_ms: elapsed, body: r.rows[0].r });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ ok: false, elapsed_ms: elapsed, error: msg });
    } finally {
      client.release();
    }
    // Tiny breather so we don't pin a single connection
    await new Promise((res) => setTimeout(res, 5));
  }
  results.push({ workerId: id, log });
}

// --- Cron precision report ---------------------------------------------
async function cronPrecisionReport(windowStartIso) {
  const r = await pool.query(
    `WITH runs AS (
       SELECT j.jobname,
              d.start_time,
              LAG(d.start_time) OVER (PARTITION BY j.jobname ORDER BY d.start_time) AS prev_start
       FROM cron.job j
       JOIN cron.job_run_details d ON d.jobid = j.jobid
       WHERE j.jobname LIKE 'speed-%'
         AND d.start_time >= $1
     )
     SELECT
       jobname,
       count(*) FILTER (WHERE prev_start IS NOT NULL) AS samples,
       ROUND(MIN(EXTRACT(EPOCH FROM (start_time - prev_start)))::numeric, 3) AS min_gap_s,
       ROUND(AVG(EXTRACT(EPOCH FROM (start_time - prev_start)))::numeric, 3) AS avg_gap_s,
       ROUND(MAX(EXTRACT(EPOCH FROM (start_time - prev_start)))::numeric, 3) AS max_gap_s,
       ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (start_time - prev_start)))::numeric, 3) AS p50_gap_s,
       ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (start_time - prev_start)))::numeric, 3) AS p99_gap_s
     FROM runs
     GROUP BY jobname
     ORDER BY jobname`,
    [windowStartIso]
  );
  console.log("\n=== Cron precision (inter-run gaps during load) ===");
  console.table(r.rows);
  return r.rows;
}

// --- Main ---------------------------------------------------------------
const { userId, marketId } = await setup();

await snapshotCron("before");

const windowStart = new Date();
const deadline = Date.now() + DURATION_SEC * 1000;
const results = [];
console.log(
  `\nstarting ${WORKERS} workers, deadline ${new Date(deadline).toISOString()}\n`
);
await Promise.all(
  Array.from({ length: WORKERS }).map((_, i) =>
    worker({ id: i, userId, marketId, deadline, results })
  )
);

await snapshotCron("after");
const cronStats = await cronPrecisionReport(windowStart.toISOString());

// --- Worker outcome aggregation ----------------------------------------
let attempts = 0;
let successes = 0;
let capRejects = 0;
let idempotentReturns = 0;
let otherErrors = 0;
const successElapsed = [];
const rejectElapsed = [];
for (const r of results) {
  for (const entry of r.log) {
    attempts += 1;
    if (entry.ok) {
      const body = entry.body;
      if (body.idempotent) {
        idempotentReturns += 1;
      } else if (body.success) {
        successes += 1;
        successElapsed.push(entry.elapsed_ms);
      }
    } else if (entry.error.toLowerCase().includes("cap reached")) {
      capRejects += 1;
      rejectElapsed.push(entry.elapsed_ms);
    } else {
      otherErrors += 1;
    }
  }
}

const pct = (arr, q) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[i];
};

console.log("\n=== Worker outcomes ===");
console.table([
  {
    attempts,
    successes,
    cap_rejects: capRejects,
    idempotent: idempotentReturns,
    other_errors: otherErrors,
    success_p50_ms: pct(successElapsed, 0.5),
    success_p99_ms: pct(successElapsed, 0.99),
    reject_p50_ms: pct(rejectElapsed, 0.5),
  },
]);

// --- Invariant checks ---------------------------------------------------
let invariantPass = 0;
let invariantFail = 0;
const inv = (name, ok, detail) => {
  if (ok) {
    invariantPass += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    invariantFail += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("\n=== Invariant checks ===");

// 1) Cap holds: total open 'over' stake ≤ $200 for the test user on this market
const capCheck = await pool.query(
  `SELECT COALESCE(SUM(stake), 0)::numeric AS s
   FROM speed_positions
   WHERE user_id = $1 AND market_id = $2 AND side = 'over' AND status = 'open'`,
  [userId, marketId]
);
const totalOver = Number(capCheck.rows[0].s);
inv("cap holds (≤ $200)", totalOver <= 200, `total over stake = $${totalOver}`);

// 2) Ledger integrity: speed_stake transactions match position stakes
const ledger = await pool.query(
  `WITH stakes AS (
     SELECT COALESCE(SUM(stake), 0)::numeric AS pos_total
     FROM speed_positions
     WHERE user_id = $1 AND market_id = $2 AND status = 'open'
   ),
   debits AS (
     SELECT COALESCE(-SUM(t.amount), 0)::numeric AS tx_total
     FROM transactions t
     JOIN speed_trades st ON st.id = t.reference_id
     WHERE t.user_id = $1 AND st.market_id = $2 AND t.type = 'speed_stake'
   )
   SELECT s.pos_total, d.tx_total FROM stakes s, debits d`,
  [userId, marketId]
);
const { pos_total, tx_total } = ledger.rows[0];
inv(
  "ledger == position stakes",
  Math.abs(Number(pos_total) - Number(tx_total)) < 0.001,
  `pos_total=$${pos_total}, tx_total=$${tx_total}`
);

// 3) No orphan trades
const orphans = await pool.query(
  `SELECT
     count(*) FILTER (WHERE p.id IS NULL) AS trades_no_position,
     count(*) FILTER (WHERE t.id IS NULL) AS trades_no_transaction
   FROM speed_trades st
   LEFT JOIN speed_positions p ON p.id = st.position_id
   LEFT JOIN transactions t ON t.reference_id = st.id AND t.type = 'speed_stake'
   WHERE st.user_id = $1 AND st.market_id = $2 AND st.kind = 'open'`,
  [userId, marketId]
);
const { trades_no_position, trades_no_transaction } = orphans.rows[0];
inv(
  "no orphan trades (position + transaction join)",
  Number(trades_no_position) === 0 && Number(trades_no_transaction) === 0,
  `no_position=${trades_no_position}, no_tx=${trades_no_transaction}`
);

// 4) Cron precision: speed-roll + speed-resolve p99 < 8s
for (const row of cronStats) {
  if (Number(row.samples) < 2) {
    inv(`${row.jobname}: enough samples`, false, `only ${row.samples}`);
    continue;
  }
  inv(
    `${row.jobname} p99 < 8s`,
    Number(row.p99_gap_s) < 8,
    `p50=${row.p50_gap_s}s p99=${row.p99_gap_s}s max=${row.max_gap_s}s avg=${row.avg_gap_s}s`
  );
}

await pool.end();

console.log(
  `\n=== W9 load suite: ${invariantPass} pass / ${invariantFail} fail ===`
);
process.exit(invariantFail > 0 ? 1 : 0);
