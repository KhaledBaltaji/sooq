// GET /api/health/oracle — public health check for the speed-oracle
// worker on EC2. Returns the age of the most recent tick in
// `speed_oracle_latest`. Used by external monitoring (uptime probes,
// CI cron) to detect a silently-dead worker before users notice trades
// rejecting with "oracle stale".
//
// Group B: bundled with the @trade switch on the worker. Pairs with the
// worker's own /health endpoint (port 3000 on the EC2 host) to provide
// public-facing visibility — the worker's endpoint is firewalled to
// dev IPs only.
//
// Returns 200 when fresh (<2s), 503 when stale (>2s — same threshold as
// fee_config.speed_oracle_stale_seconds, beyond which speed_execute_trade
// rejects new bets).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

interface LatestRow {
  [key: string]: unknown;
  asset: string;
  age_ms: number;
  price: string;
}

const STALE_THRESHOLD_MS = 2_000;

export async function GET() {
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
