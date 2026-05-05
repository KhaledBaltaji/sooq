// GET /api/admin/withdrawals/list?status=pending&limit=50&offset=0
// Admin-only. Calls get_admin_withdrawals RPC via runAs() so the
// app.user_id GUC is set for the SECURITY DEFINER's is_admin gate.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "sent"] as const;

interface AdminWithdrawalRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  user_avatar_url: string | null;
  user_balance_usd: string;
  amount: string;
  fee_amount: string;
  net_amount: string | null;
  method: string;
  account_details: unknown;
  status: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const status =
      statusParam && (ALLOWED_STATUSES as readonly string[]).includes(statusParam)
        ? statusParam
        : null;
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(200, limitParam))
      : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<AdminWithdrawalRow>(
        sql`SELECT * FROM get_admin_withdrawals(${status}::text, ${limit}::int, ${offset}::int)`
      );
    });

    return NextResponse.json({
      withdrawals: result.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          email: r.user_email,
          display_name: r.user_display_name,
          avatar_url: r.user_avatar_url,
          balance_usd: Number(r.user_balance_usd ?? 0),
        },
        amount: Number(r.amount),
        fee_amount: Number(r.fee_amount ?? 0),
        net_amount: r.net_amount == null ? null : Number(r.net_amount),
        method: r.method,
        account_details: r.account_details,
        status: r.status,
        reviewer_id: r.reviewer_id,
        reviewed_at: r.reviewed_at,
        sent_at: r.sent_at,
        notes: r.notes,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("admin/withdrawals/list failed", { source: "api/admin/withdrawals/list", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
