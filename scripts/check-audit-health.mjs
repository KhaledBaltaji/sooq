// scripts/check-audit-health.mjs — exits non-zero if any of the four
// platform invariants fail:
//   1. Stuck markets (status='open' AND closes_at < NOW() - 30s)
//   2. Cron freshness (last successful speed-roll/speed-resolve > 30s ago)
//   3. Ledger drift (users.balance_usd vs SUM(transactions) > $0.01)
//   4. T4.1 (mig 0033): cashout speed_trades rows with no paired tx row.
//      $0 cashouts pre-mig-0033 silently skipped the tx INSERT — orphan
//      trade rows. Mig 0033 fixed it; this check guards against regression.
//
// Used by .github/workflows/audit-monitor.yml every 5 minutes. Catches
// the class of silent failures that hid the mig 0016 settlement bug
// for hours (cron caught the inner exception and reported success=true).
//
// Usage:
//   node scripts/check-audit-health.mjs           # exit 0 = healthy, 1 = drift
//   node scripts/check-audit-health.mjs --json    # machine-readable
//
// DATABASE_URL must be set (.env.local locally; GitHub secret in CI).

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const STUCK_THRESHOLD_S = 30;
const CRON_STALE_THRESHOLD_S = 30;
const LEDGER_TOLERANCE_USD = 0.01;
const JSON_MODE = process.argv.includes("--json");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const url = process.env.DATABASE_URL.replace(
  /([?&])sslmode=[^&]+(&|$)/i,
  (_m, prefix, suffix) => (suffix === "&" ? prefix : ""),
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const fail = (msg) => {
  if (!JSON_MODE) console.error("FAIL:", msg);
  return msg;
};

try {
  const failures = [];

  // 1. Stuck markets
  const stuck = await client.query(
    `SELECT COUNT(*)::int AS n FROM speed_markets
     WHERE status = 'open' AND closes_at < NOW() - INTERVAL '${STUCK_THRESHOLD_S} seconds'`,
  );
  const stuckN = Number(stuck.rows[0]?.n ?? 0);
  if (stuckN > 0) failures.push(fail(`${stuckN} stuck markets (open, past close + ${STUCK_THRESHOLD_S}s)`));

  // 2. Cron freshness
  const cron = await client.query(`
    SELECT j.jobname,
           EXTRACT(EPOCH FROM (NOW() - MAX(r.end_time)
             FILTER (WHERE r.status = 'succeeded')))::numeric AS last_ok_age_s
    FROM cron.job j
    LEFT JOIN cron.job_run_details r ON r.jobid = j.jobid
      AND r.start_time > NOW() - INTERVAL '5 minutes'
    WHERE j.jobname IN ('speed-roll', 'speed-resolve')
    GROUP BY j.jobname
  `);
  const cronStale = cron.rows.filter(
    (r) => r.last_ok_age_s == null || Number(r.last_ok_age_s) > CRON_STALE_THRESHOLD_S,
  );
  if (cronStale.length > 0) {
    for (const j of cronStale) {
      const age = j.last_ok_age_s == null ? "no recent run" : `${Number(j.last_ok_age_s).toFixed(1)}s ago`;
      failures.push(fail(`cron ${j.jobname} stale (last ok: ${age})`));
    }
  }

  // 3. Ledger drift
  const drift = await client.query(`
    WITH ledger AS (
      SELECT u.id, u.balance_usd::numeric AS cached,
             COALESCE(SUM(t.amount)::numeric, 0) AS ledger
      FROM users u LEFT JOIN transactions t ON t.user_id = u.id
      GROUP BY u.id, u.balance_usd
    )
    SELECT COUNT(*)::int AS n FROM ledger
    WHERE ABS(cached - ledger) > ${LEDGER_TOLERANCE_USD}
  `);
  const driftN = Number(drift.rows[0]?.n ?? 0);
  if (driftN > 0) failures.push(fail(`${driftN} users with balance/ledger drift > $${LEDGER_TOLERANCE_USD}`));

  // 4. T4.1 (mig 0033): orphan cashout trades — speed_trades rows of kind
  // 'cashout' that have no paired transactions row. Pre-mig-0033 these
  // happened on $0 cashouts; mig 0033 dropped the IF guard so all cashouts
  // now write a tx row. Catches regression OR pre-mig-0033 stragglers.
  const orphanCashout = await client.query(`
    SELECT COUNT(*)::int AS n FROM speed_trades st
    WHERE st.kind = 'cashout'
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.reference_id = st.id AND t.type = 'speed_cashout'
      )
  `);
  const orphanCashoutN = Number(orphanCashout.rows[0]?.n ?? 0);
  if (orphanCashoutN > 0) {
    failures.push(fail(`${orphanCashoutN} orphan cashout trades (no paired tx row — mig 0033 regression?)`));
  }

  const ok = failures.length === 0;

  if (JSON_MODE) {
    console.log(JSON.stringify({
      ok,
      stuck_markets: stuckN,
      cron_jobs: cron.rows.map((r) => ({ jobname: r.jobname, last_ok_age_s: r.last_ok_age_s == null ? null : Number(r.last_ok_age_s) })),
      ledger_drift_users: driftN,
      orphan_cashout_trades: orphanCashoutN,
      failures,
    }));
  } else if (ok) {
    console.log(`OK: 0 stuck markets, cron fresh, 0 ledger drift, 0 orphan cashouts`);
  }

  process.exit(ok ? 0 : 1);
} finally {
  await client.end().catch(() => {});
}
