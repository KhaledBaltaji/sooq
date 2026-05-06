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
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

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
