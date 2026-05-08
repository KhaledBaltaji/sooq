// GET /api/health/oracle — gated health check for the speed-oracle
// worker on EC2.
//
// S0.6 (mig 0038): this endpoint used to be PUBLIC and returned every
// asset's full oracle row (asset, age_ms, price). Anyone could poll it
// and snapshot every current price the platform sees, killing the data
// advantage. Now requires admin session OR x-monitor-token bearer.
//
// External monitors (GitHub Actions, uptime probes) pass:
//   curl -H "x-monitor-token: $HEALTH_MONITOR_TOKEN" https://staging.sooq.exchange/api/health/oracle
//
// Returns 200 when fresh (<2s), 503 when stale (>2s — same threshold as
// fee_config.speed_oracle_stale_seconds, beyond which speed_execute_trade
// rejects new bets). Per-asset prices are ONLY included in authorized
// responses; without them, the response is just {ok, oldest_age_ms,
// threshold_ms} so a leaked endpoint reveals timing only.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authErrorToResponse, requireAdminOrMonitorToken } from "@/lib/auth/api-guards";

interface LatestRow {
  [key: string]: unknown;
  asset: string;
  age_ms: number;
  price: string;
}

const STALE_THRESHOLD_MS = 2_000;

export async function GET(req: Request) {
  try {
    await requireAdminOrMonitorToken(req);
  } catch (err) {
    const resp = authErrorToResponse(err);
    if (resp) return resp;
    throw err;
  }

  try {
    const result = await db.execute<LatestRow>(sql`
      SELECT
        asset::text AS asset,
        EXTRACT(EPOCH FROM (NOW() - received_at)) * 1000 AS age_ms,
        price::text AS price
      FROM speed_oracle_latest
    `);

    const rows = result.rows;
    if (rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no rows in speed_oracle_latest",
        },
        { status: 503 },
      );
    }

    const oldest = rows.reduce((acc, r) =>
      Number(r.age_ms) > Number(acc.age_ms) ? r : acc,
    );
    const oldestAgeMs = Number(oldest.age_ms);
    const ok = oldestAgeMs < STALE_THRESHOLD_MS;

    return NextResponse.json(
      {
        ok,
        oldest_age_ms: Math.round(oldestAgeMs),
        threshold_ms: STALE_THRESHOLD_MS,
        rows: rows.map((r) => ({
          asset: r.asset,
          age_ms: Math.round(Number(r.age_ms)),
          price: Number(r.price),
        })),
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
