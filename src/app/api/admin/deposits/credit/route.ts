// POST /api/admin/deposits/credit
// Manual Whish credit. Admin-only. Body: { user_id, amount, provider_ref, notes? }.
// Inserts a verified deposit row + credits balance + writes ledger via
// admin_credit_deposit RPC (no PIN; matches mig 0015 pattern).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

interface CreditBody {
  user_id?: string;
  amount?: number;
  provider_ref?: string;
  notes?: string | null;
}

interface CreditResult {
  deposit_id: string;
  amount: number;
  new_balance: number;
  status: string;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const body = (await req.json()) as CreditBody;
    const userId = body.user_id?.trim();
    const amount = Number(body.amount);
    const providerRef = body.provider_ref?.trim();
    const notes = body.notes ?? null;

    if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
    }
    if (!providerRef || providerRef.length < 3) {
      return NextResponse.json({ error: "provider_ref required (min 3 chars)" }, { status: 400 });
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: CreditResult }>(sql`
        SELECT (admin_credit_deposit(
          ${userId}::uuid,
          ${amount}::numeric,
          ${providerRef}::text,
          ${notes}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: CreditResult } | undefined)?.result ?? null;
    });

    if (!data) return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("admin/deposits/credit failed", { source: "api/admin/deposits/credit", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
