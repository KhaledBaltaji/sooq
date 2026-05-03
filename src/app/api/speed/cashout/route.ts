// POST /api/speed/cashout — early exit a position at the current price.
//
// Calls speed_execute_cashout(position_id, idempotency_key).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

interface CashoutBody {
  position_id: string;
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

    const body = (await req.json()) as CashoutBody;
    const { position_id, idempotency_key, expected_iv } = body;

    if (!position_id) {
      return NextResponse.json({ error: "Missing position_id" }, { status: 400 });
    }

    const data = await runAs(session.user.id, async (tx) => {
      const r = await tx.execute<{ result: unknown }>(sql`
        SELECT (speed_execute_cashout(
          ${position_id}::uuid,
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
    logger.error("speed_execute_cashout failed", { source: "api/speed/cashout", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
