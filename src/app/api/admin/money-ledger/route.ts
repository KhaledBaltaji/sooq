// GET /api/admin/money-ledger?from=&to=&user_id=&types=deposit,withdrawal,...&limit=&offset=
// History tab. Reads `transactions` directly (filtered to money types) via
// get_admin_money_ledger RPC.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = ["deposit", "withdrawal", "admin_credit", "admin_debit"] as const;

interface LedgerRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  type: string;
  amount: string;
  balance_after: string;
  description: string | null;
  reference_id: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  created_at: string;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const userParam = url.searchParams.get("user_id");
    const typesParam = url.searchParams.get("types");
    const limitParam = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const types = typesParam
      ? typesParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is (typeof ALLOWED_TYPES)[number] =>
            (ALLOWED_TYPES as readonly string[]).includes(s)
          )
      : null;

    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, limitParam)) : 200;
    const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<LedgerRow>(
        sql`SELECT * FROM get_admin_money_ledger(
          ${from ? from.toISOString() : null}::timestamptz,
          ${to ? to.toISOString() : null}::timestamptz,
          ${userParam ?? null}::uuid,
          ${types && types.length > 0 ? types : null}::text[],
          ${limit}::int,
          ${offset}::int
        )`
      );
    });

    return NextResponse.json({
      entries: result.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user: { email: r.user_email, display_name: r.user_display_name },
        type: r.type,
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        description: r.description,
        reference_id: r.reference_id,
        performed_by: r.performed_by,
        performed_by_email: r.performed_by_email,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("admin/money-ledger failed", { source: "api/admin/money-ledger", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
