// admin_adjust_balance wrapper — manual credit/debit.
//
// S0.16 (mig 0039): all inputs validated with zod before hitting the RPC.
// Untrusted input is the most common silent-break source on admin endpoints
// (long descriptions tripping RPC constraints, unicode in pins, etc.).
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

const adjustSchema = z.object({
  user_id: z.string().uuid("user_id must be a UUID"),
  amount: z
    .number()
    .refine((n) => n !== 0, { message: "amount cannot be zero" })
    .refine((n) => Math.abs(n) <= 10000, { message: "|amount| must be <= 10000" }),
  description: z.string().min(3).max(200),
  pin: z.string().regex(/^\d{4,6}$/, "pin must be 4-6 digits"),
});

interface AdjustResult {
  transaction_id: string;
  new_balance: number;
  type: string;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const raw = await req.json().catch(() => ({}));
    const parsed = adjustSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues.map((i) => i.message) },
        { status: 400 }
      );
    }
    const { user_id, amount, description, pin } = parsed.data;

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
