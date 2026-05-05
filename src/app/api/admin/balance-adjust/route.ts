// POST /api/admin/balance-adjust
// No-PIN admin manual credit/debit. Body: { user_id, amount, reason }.
// Positive amount = credit, negative = debit. Wraps admin_balance_adjust_v2.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

interface AdjustBody {
  user_id?: string;
  amount?: number;
  reason?: string;
}

interface AdjustResult {
  transaction_id: string;
  new_balance: number;
  type: "admin_credit" | "admin_debit";
  amount: number;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const body = (await req.json()) as AdjustBody;
    const userId = body.user_id?.trim();
    const amount = Number(body.amount);
    const reason = body.reason?.trim() ?? "";

    if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "amount must be non-zero" }, { status: 400 });
    }
    if (Math.abs(amount) > 10000) {
      return NextResponse.json({ error: "amount exceeds $10,000 cap" }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json({ error: "reason required (min 3 chars)" }, { status: 400 });
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: AdjustResult }>(sql`
        SELECT (admin_balance_adjust_v2(
          ${userId}::uuid,
          ${amount}::numeric,
          ${reason}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: AdjustResult } | undefined)?.result ?? null;
    });

    if (!data) return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("admin/balance-adjust failed", { source: "api/admin/balance-adjust", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
