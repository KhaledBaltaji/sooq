// POST /api/withdrawal/process — user-initiated withdrawal.
//
// Calls process_withdrawal(amount, method, account_details) inside runAs()
// so the RPC sees the caller's app.user_id.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

interface WithdrawBody {
  amount: number;
  method: "whish" | "crypto" | "bank";
  account_details: Record<string, unknown>;
}

interface WithdrawResult {
  withdrawal_id: string;
  amount: number;
  new_balance: number;
  status: string;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as WithdrawBody;
    const { amount, method, account_details } = body;

    if (!amount || !method || !account_details) {
      return NextResponse.json(
        { error: "Missing required fields: amount, method, account_details" },
        { status: 400 }
      );
    }
    if (!["whish", "crypto", "bank"].includes(method)) {
      return NextResponse.json({ error: "Invalid method" }, { status: 400 });
    }

    const data = await runAs(session.user.id, async (tx) => {
      const r = await tx.execute<{ result: WithdrawResult }>(sql`
        SELECT (process_withdrawal(
          ${amount}::numeric,
          ${method}::text,
          ${JSON.stringify(account_details)}::jsonb
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: WithdrawResult } | undefined)?.result ?? null;
    });

    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("process_withdrawal failed", { source: "api/withdrawal/process", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
