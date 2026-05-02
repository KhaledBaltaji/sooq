// admin_adjust_balance wrapper — manual credit/debit.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

interface AdjustBody {
  user_id: string;
  amount: number;
  description: string;
  pin: string;
}

interface AdjustResult {
  transaction_id: string;
  new_balance: number;
  type: string;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const { user_id, amount, description, pin } = (await req.json()) as AdjustBody;

    if (!user_id || amount === undefined || !description || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: user_id, amount, description, pin" },
        { status: 400 }
      );
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: AdjustResult }>(sql`
        SELECT (admin_adjust_balance(
          ${user_id}::uuid,
          ${amount}::numeric,
          ${description}::text,
          ${pin}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: AdjustResult } | undefined)?.result ?? null;
    });

    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("admin_adjust_balance failed", { source: "api/admin/balance", errorMessage: msg }, err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
