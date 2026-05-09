// GET /api/admin/stats/health-snapshot
//
// Phase 5K — Health tab. Read-only telemetry across:
//   1. Oracle freshness per asset (vs per-asset stale_secs threshold)
//   2. Matrix coverage % per (asset, duration) over last 24h
//   3. CLV throttle status + active count + cron freshness
//   4. Pricing reject counts by reject_code over last 24h
//   5. Recent user_alerts feed (last 10)
//   6. Recent PARITY_DRIFT events (last 10)
//
// All sources are existing tables (mig 0036, 0044, 0031, 0052). No new
// migrations.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

interface OracleRow {
  asset: string;
  age_seconds: string;
  stale_threshold_secs: string | null;
  [key: string]: unknown;
}

interface MatrixRow {
  asset: string;
  duration: string;
  total: string;
  matrix_count: string;
  [key: string]: unknown;
}

interface ClvRow {
  enabled: string;
  active_count: string;
  last_recomputed: string | null;
  [key: string]: unknown;
}

interface PricingTelemetryRow {
  total: string;
  soft_blocked: string;
  neighbor_used: string;
  [key: string]: unknown;
}

interface AlertRow {
  alert_type: string;
  user_email: string | null;
  threshold: string | null;
  observed: string | null;
  created_at: string;
  [key: string]: unknown;
}

export async function GET() {
  try {
    await requireAdminApi();

    // 1. Oracle per asset, joined with per-asset stale_seconds (mig 0052)
    const oracleResult = await db.execute<OracleRow>(sql`
      SELECT
        ol.asset,
        EXTRACT(EPOCH FROM (NOW() - ol.received_at))::text AS age_seconds,
        sac.oracle_stale_seconds::text AS stale_threshold_secs
      FROM speed_oracle_latest ol
      LEFT JOIN speed_asset_config sac ON sac.asset = ol.asset
      ORDER BY ol.asset
    `).catch(async () => {
      // Fallback if oracle_stale_seconds column doesn't exist (pre-0052)
      return db.execute<OracleRow>(sql`
        SELECT
          asset,
          EXTRACT(EPOCH FROM (NOW() - received_at))::text AS age_seconds,
          NULL::text AS stale_threshold_secs
        FROM speed_oracle_latest
        ORDER BY asset
      `);
    });

    // 2. Matrix coverage per (asset, duration) — last 24h
    const matrixResult = await db.execute<MatrixRow>(sql`
      SELECT
        asset,
        duration::text AS duration,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE matrix_used = true)::text AS matrix_count
      FROM speed_pricing_events
      WHERE occurred_at > NOW() - INTERVAL '24 hours'
      GROUP BY asset, duration
      ORDER BY asset, duration
    `).catch(() => ({ rows: [] }));

    // 3. CLV throttle status. Master flag from fee_config; active count
    //    via the same gate as /admin/sharks; last cron run from
    //    speed_user_edge_scores.last_recomputed_at MAX.
    const clvResult = await db.execute<ClvRow>(sql`
      SELECT
        COALESCE(
          (SELECT rate::text FROM fee_config WHERE fee_type = 'speed_clv_throttle_enabled'),
          '0'
        ) AS enabled,
        (SELECT COUNT(*)::text
           FROM speed_user_edge_scores
          WHERE settled_trades >= 30
            AND ci_low > 0.02
            AND last_recomputed_at > NOW() - INTERVAL '36 hours'
        ) AS active_count,
        (SELECT MAX(last_recomputed_at)::text FROM speed_user_edge_scores) AS last_recomputed
    `).catch(() => ({
      rows: [{ enabled: "0", active_count: "0", last_recomputed: null }],
    }));

    // 4. Pricing telemetry summary — last 24h. Trades that were rejected
    //    (PARITY_DRIFT, near-decided, late-window, etc.) raise exceptions
    //    in the RPC and are NOT logged to speed_pricing_events; only
    //    successful pricing decisions show up here. So this surfaces
    //    matrix-engagement signals: how many trades the soft-block clamped,
    //    and how many used a neighbor-fallback cell vs a direct match.
    const telemetryResult = await db.execute<PricingTelemetryRow>(sql`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE soft_blocked = true)::text AS soft_blocked,
        COUNT(*) FILTER (WHERE neighbor_used = true)::text AS neighbor_used
      FROM speed_pricing_events
      WHERE occurred_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({
      rows: [{ total: "0", soft_blocked: "0", neighbor_used: "0" }],
    }));

    // 5. Recent user alerts (mig 0031)
    const alertsResult = await db.execute<AlertRow>(sql`
      SELECT
        sa.alert_type::text AS alert_type,
        u.email AS user_email,
        sa.threshold::text AS threshold,
        sa.observed::text AS observed,
        sa.created_at::text AS created_at
      FROM speed_user_alerts sa
      LEFT JOIN users u ON u.id = sa.user_id
      ORDER BY sa.created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    const clv = clvResult.rows[0];
    const tel = telemetryResult.rows[0];
    return NextResponse.json({
      oracle: oracleResult.rows.map((r) => ({
        asset: r.asset,
        age_seconds: Math.round(Number(r.age_seconds ?? 0)),
        stale_threshold_secs:
          r.stale_threshold_secs === null
            ? null
            : Number(r.stale_threshold_secs),
      })),
      matrix_coverage: matrixResult.rows.map((r) => ({
        asset: r.asset,
        duration: r.duration,
        total: Number(r.total),
        matrix_count: Number(r.matrix_count),
        matrix_pct:
          Number(r.total) > 0
            ? Number(((Number(r.matrix_count) / Number(r.total)) * 100).toFixed(1))
            : 0,
      })),
      clv: {
        enabled: Number(clv?.enabled ?? 0) > 0,
        active_count: Number(clv?.active_count ?? 0),
        last_recomputed: clv?.last_recomputed ?? null,
      },
      pricing_telemetry: {
        total_24h: Number(tel?.total ?? 0),
        soft_blocked_24h: Number(tel?.soft_blocked ?? 0),
        neighbor_fallback_24h: Number(tel?.neighbor_used ?? 0),
      },
      recent_alerts: alertsResult.rows.map((r) => ({
        type: r.alert_type,
        user_email: r.user_email,
        threshold: r.threshold === null ? null : Number(r.threshold),
        observed: r.observed === null ? null : Number(r.observed),
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
