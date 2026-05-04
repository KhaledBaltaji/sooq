// GET /api/health/audit — public health check for speed-mode invariants
// the platform depends on but doesn't surface anywhere else. Mirrors
// /api/health/oracle. Used by .github/workflows/audit-monitor.yml.
//
// Three checks:
//   1. Stuck markets — any speed_markets with status='open' AND
//      closes_at < NOW() - 30s. The mig 0016 settlement bug hid for
//      hours because cron caught the inner exception silently; this
//      check would have caught it within ~30s.
//   2. Cron freshness — last successful speed-roll/speed-resolve run
//      should be < 30s ago.
//   3. Ledger drift — count of users where users.balance_usd diverges
//      from SUM(transactions.amount) by more than $0.01.
//
// Plus exposes the speed_cashout_enabled kill switch state so admins
// can verify quoting is up.
//
// Returns 200 when all checks pass, 503 when any fail.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const STUCK_THRESHOLD_S = 30;
const CRON_STALE_THRESHOLD_S = 30;
const LEDGER_TOLERANCE_USD = 0.01;

// drizzle's db.execute<T> constraint requires T extends Record<string,
// unknown>; the index signature satisfies it without changing runtime
// behavior.
type StuckRow = { n: number; [k: string]: unknown };
type CronRow = { jobname: string; last_ok_age_s: number | null; [k: string]: unknown };
type DriftRow = { n: number; [k: string]: unknown };
type KillSwitchRow = { rate: string | null; [k: string]: unknown };

export async function GET() {
  try {
    const stuckRes = await db.execute<StuckRow>(sql`
      SELECT COUNT(*)::int AS n FROM speed_markets
      WHERE status = 'open'
        AND closes_at < NOW() - (${STUCK_THRESHOLD_S} || ' seconds')::interval
    `);
    const stuck = Number(stuckRes.rows[0]?.n ?? 0);

    const cronRes = await db.execute<CronRow>(sql`
      SELECT j.jobname,
             EXTRACT(EPOCH FROM (NOW() - MAX(r.end_time)
               FILTER (WHERE r.status = 'succeeded')))::int AS last_ok_age_s
      FROM cron.job j
      LEFT JOIN cron.job_run_details r ON r.jobid = j.jobid
        AND r.start_time > NOW() - INTERVAL '5 minutes'
      WHERE j.jobname IN ('speed-roll', 'speed-resolve')
      GROUP BY j.jobname
    `);
    const cronJobs = cronRes.rows.map((r) => ({
      jobname: r.jobname,
      last_ok_age_s: r.last_ok_age_s == null ? null : Number(r.last_ok_age_s),
    }));
    const cronStale = cronJobs.filter(
      (j) => j.last_ok_age_s == null || j.last_ok_age_s > CRON_STALE_THRESHOLD_S,
    );

    const driftRes = await db.execute<DriftRow>(sql`
      WITH ledger AS (
        SELECT u.id, u.balance_usd::numeric AS cached,
               COALESCE(SUM(t.amount)::numeric, 0) AS ledger
        FROM users u LEFT JOIN transactions t ON t.user_id = u.id
        GROUP BY u.id, u.balance_usd
      )
      SELECT COUNT(*)::int AS n FROM ledger
      WHERE ABS(cached - ledger) > ${LEDGER_TOLERANCE_USD}
    `);
    const drift = Number(driftRes.rows[0]?.n ?? 0);

    const killRes = await db.execute<KillSwitchRow>(sql`
      SELECT rate::text FROM fee_config WHERE fee_type = 'speed_cashout_enabled' LIMIT 1
    `);
    const cashoutEnabled =
      killRes.rows.length === 0 ? null : Number(killRes.rows[0].rate) > 0;

    const ok = stuck === 0 && cronStale.length === 0 && drift === 0;

    return NextResponse.json(
      {
        ok,
        stuck_markets: stuck,
        cron_jobs: cronJobs,
        cron_stale: cronStale,
        ledger_drift_users: drift,
        cashout_enabled: cashoutEnabled,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: err instanceof Error ? err.message : "internal",
      },
      { status: 500 },
    );
  }
}
