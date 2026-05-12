// POST /api/speed/trade — execute a speed trade as the current user.
//
// Calls speed_execute_trade(market_id, side, stake, idempotency_key,
// expected_iv?, expected_spot?, expected_seconds_left_bucket?,
// expected_fair_prob?, expected_offered_prob?) inside a runAs() transaction
// so the RPC sees the caller's app.user_id.
//
// Mig 0030: extends `expected_iv` (the original quote/execute parity check)
// with full quote/execute parity on spot, seconds-left bucket, fair_prob,
// and offered_prob. All new fields are optional — clients that pass NULL
// skip the check (backwards-compat). New clients fetched from /api/speed/quote
// receive the snapshot fields and must echo them back to enforce parity.
//
// Mig 0028: server NEVER prices with client-supplied IV. `expected_iv` is
// a stale-quote check ONLY; the server always uses its own IV (from
// _speed_get_iv() helper, mig 0029) for pricing.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";
import { getSpeedFlags, isMarketEnabled } from "@/lib/speed/feature-flags";
import { checkRateLimit, getClientIp } from "@/lib/speed/rate-limit";
import type { SpeedAsset, SpeedDuration } from "@/types/database";

interface TradeBody {
  market_id: string;
  side: "over" | "under";
  stake: number;
  idempotency_key?: string;
  // Quote/execute parity snapshot — all optional. NULL skips the check.
  expected_iv?: number;
  expected_spot?: number;
  expected_seconds_left_bucket?: number; // 0=60s+, 1=30-60s, 2=10-30s, 3=<10s (rejected)
  expected_fair_prob?: number;
  expected_offered_prob?: number;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkRateLimit("trade", session.user.id, getClientIp(req));
    if (!rl.ok) {
      // Plan B4: friendly, structured 429. Client `mapSpeedRpcError`
      // matches on "Slow down" / code:RATE_LIMITED to render the same
      // plain-English copy.
      return NextResponse.json(
        {
          error: `Slow down — you can place a new trade in ${rl.retryAfter}s`,
          code: "RATE_LIMITED",
          retryAfter: rl.retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = (await req.json()) as TradeBody;
    const {
      market_id,
      side,
      stake,
      idempotency_key,
      expected_iv,
      expected_spot,
      expected_seconds_left_bucket,
      expected_fair_prob,
      expected_offered_prob,
    } = body;

    if (!market_id || !side || !stake) {
      return NextResponse.json(
        { error: "Missing required fields: market_id, side, stake" },
        { status: 400 }
      );
    }
    if (side !== "over" && side !== "under") {
      return NextResponse.json({ error: "Invalid side" }, { status: 400 });
    }

    // Step 9 pre-flight: short-circuit if trading is globally disabled.
    // The RPC enforces the same; this just avoids spending a DB txn.
    const flags = await getSpeedFlags();
    if (!flags.trading_enabled) {
      return NextResponse.json(
        { error: "Speed markets are currently disabled" },
        { status: 400 }
      );
    }

    // Look up the market's asset+duration cheaply to check per-asset and
    // per-duration gates before opening the heavyweight runAs transaction.
    const mkt = await db.execute(sql`
      SELECT asset::text AS asset, duration::text AS duration
      FROM speed_markets WHERE id = ${market_id}::uuid
    `);
    const row = mkt.rows[0] as { asset: SpeedAsset; duration: SpeedDuration } | undefined;
    if (!row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    if (row.asset === "GOLD" && !flags.enabled_gold) {
      return NextResponse.json(
        { error: "Gold markets are currently disabled" },
        { status: 400 }
      );
    }
    if (row.duration === "1m" && !flags.enabled_1m) {
      return NextResponse.json(
        { error: "1-minute markets are currently disabled" },
        { status: 400 }
      );
    }
    if (!isMarketEnabled(flags, row.asset, row.duration)) {
      return NextResponse.json(
        { error: "This market is currently disabled" },
        { status: 400 }
      );
    }

    const data = await runAs(session.user.id, async (tx) => {
      const r = await tx.execute<{ result: unknown }>(sql`
        SELECT (speed_execute_trade(
          ${market_id}::uuid,
          ${side}::text,
          ${stake}::numeric,
          ${idempotency_key ?? null}::text,
          ${expected_iv ?? null}::decimal,
          ${expected_spot ?? null}::decimal,
          ${expected_seconds_left_bucket ?? null}::integer,
          ${expected_fair_prob ?? null}::decimal,
          ${expected_offered_prob ?? null}::decimal
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: unknown } | undefined)?.result ?? null;
    });

    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("speed_execute_trade failed", { source: "api/speed/trade", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
