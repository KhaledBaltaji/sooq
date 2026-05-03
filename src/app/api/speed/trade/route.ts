// POST /api/speed/trade — execute a speed trade as the current user.
//
// Calls speed_execute_trade(market_id, side, stake, idempotency_key) inside
// a runAs() transaction so the RPC sees the caller's app.user_id.

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
  // Mig 369: client-side IV snapshot for quote/execute parity. If present,
  // server checks drift and either uses it for pricing or returns IV_DRIFT.
  expected_iv?: number;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as TradeBody;
    const { market_id, side, stake, idempotency_key, expected_iv } = body;

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
          ${expected_iv ?? null}::decimal
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
