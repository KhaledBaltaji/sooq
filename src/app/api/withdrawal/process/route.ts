// POST /api/withdrawal/process — user-initiated withdrawal.
//
// Calls process_withdrawal(amount, method, account_details, idempotency_key)
// inside runAs() so the RPC sees the caller's app.user_id.
//
// S0.4 (mig 0038): idempotency_key is computed deterministically from
// (user_id, amount, method, account hash, minute-bucket). Rapid double-submit
// (double-click, network retry) within the same minute returns the existing
// withdrawal record instead of debiting twice. Client may also pass an
// explicit idempotency_key to override the default; honored when provided.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

interface WithdrawBody {
  amount: number;
  method: "whish" | "crypto" | "bank";
  account_details: Record<string, unknown>;
  idempotency_key?: string;
}

interface WithdrawResult {
  withdrawal_id: string;
  amount: number;
  fee: number;
  net: number;
  new_balance: number;
  status: string;
  idempotent?: boolean;
  message?: string;
}

function computeIdempotencyKey(
  userId: string,
  amount: number,
  method: string,
  accountDetails: Record<string, unknown>
): string {
  // Bucket per minute. A user resubmitting the same withdrawal in the same
  // minute is virtually always a duplicate; across minute boundaries we treat
  // it as a fresh intent.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const accountHash = createHash("sha256")
    .update(JSON.stringify(accountDetails))
    .digest("hex")
    .slice(0, 16);
  return `${userId}:${amount}:${method}:${accountHash}:${minuteBucket}`;
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

    const idempotencyKey =
      body.idempotency_key ??
      computeIdempotencyKey(session.user.id, amount, method, account_details);

    const data = await runAs(session.user.id, async (tx) => {
      const r = await tx.execute<{ result: WithdrawResult }>(sql`
        SELECT (process_withdrawal(
          ${amount}::numeric,
          ${method}::text,
          ${JSON.stringify(account_details)}::jsonb,
          ${idempotencyKey}::text
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
