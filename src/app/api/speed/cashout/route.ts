// POST /api/speed/cashout — early exit a position at the current price.
//
// Calls speed_execute_cashout(position_id, idempotency_key, expected_iv?,
// expected_spot?, expected_seconds_left_bucket?, expected_mark_prob?,
// expected_cashout_amount?).
//
// Mig 0030: extends `expected_iv` with full quote/execute parity on spot,
// seconds-left bucket, mark_prob, and cashout_amount. All optional —
// NULL skips the check.
//
// Mig 0028: cashout uses profit-based margin (option C). Direction-matching
// invariant: if mark_prob > entry_offered_prob (winning), cashout > stake
// always. Enforced both algebraically by formula shape and by an RPC-side
// invariant assertion that raises if it ever fails.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

interface CashoutBody {
  position_id: string;
  idempotency_key?: string;
  // Quote/execute parity snapshot — all optional. NULL skips the check.
  expected_iv?: number;
  expected_spot?: number;
  expected_seconds_left_bucket?: number;
  expected_mark_prob?: number;
  expected_cashout_amount?: number;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CashoutBody;
    const {
      position_id,
      idempotency_key,
      expected_iv,
      expected_spot,
      expected_seconds_left_bucket,
      expected_mark_prob,
      expected_cashout_amount,
    } = body;

    if (!position_id) {
      return NextResponse.json({ error: "Missing position_id" }, { status: 400 });
    }

    const data = await runAs(session.user.id, async (tx) => {
      const r = await tx.execute<{ result: unknown }>(sql`
        SELECT (speed_execute_cashout(
          ${position_id}::uuid,
          ${idempotency_key ?? null}::text,
          ${expected_iv ?? null}::decimal,
          ${expected_spot ?? null}::decimal,
          ${expected_seconds_left_bucket ?? null}::integer,
          ${expected_mark_prob ?? null}::decimal,
          ${expected_cashout_amount ?? null}::numeric
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
    logger.error("speed_execute_cashout failed", { source: "api/speed/cashout", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
