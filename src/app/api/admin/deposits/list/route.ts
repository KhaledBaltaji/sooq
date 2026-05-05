// GET /api/admin/deposits/list?status=pending&limit=50&offset=0
// Admin-only. Backs the Deposits tab on /admin/money.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

const ALLOWED_STATUSES = ["pending", "verified", "rejected", "expired"] as const;

interface AdminDepositRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  user_avatar_url: string | null;
  user_balance_usd: string;
  amount: string;
  currency: string;
  provider: string;
  provider_ref: string;
  status: string;
  proof_url: string | null;
  created_at: string;
  verified_at: string | null;
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
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, limitParam)) : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<AdminDepositRow>(
        sql`SELECT * FROM get_admin_deposits(${status}::text, ${limit}::int, ${offset}::int)`
      );
    });

    return NextResponse.json({
      deposits: result.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          email: r.user_email,
          display_name: r.user_display_name,
          avatar_url: r.user_avatar_url,
          balance_usd: Number(r.user_balance_usd ?? 0),
        },
        amount: Number(r.amount),
        currency: r.currency,
        provider: r.provider,
        provider_ref: r.provider_ref,
        status: r.status,
        proof_url: r.proof_url,
        created_at: r.created_at,
        verified_at: r.verified_at,
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("admin/deposits/list failed", { source: "api/admin/deposits/list", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
