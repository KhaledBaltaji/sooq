// GET /api/admin/stats/revenue-summary?from=&to=
// Single-row totals across the date range.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

interface RevenueSummaryRow {
  [key: string]: unknown;
  gross_volume: string;
  total_payouts: string;
  platform_net: string;
  cashout_premium_total: string;
  open_cash_pool: string;
  markets_resolved: number;
  markets_voided: number;
  unique_traders: number;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<RevenueSummaryRow>(
        sql`SELECT * FROM get_stats_revenue_summary(
          ${from ? from.toISOString() : null}::timestamptz,
          ${to ? to.toISOString() : null}::timestamptz
        )`
      );
    });

    const r = result.rows[0];
    return NextResponse.json({
      gross_volume: Number(r?.gross_volume ?? 0),
      total_payouts: Number(r?.total_payouts ?? 0),
      platform_net: Number(r?.platform_net ?? 0),
      cashout_premium_total: Number(r?.cashout_premium_total ?? 0),
      open_cash_pool: Number(r?.open_cash_pool ?? 0),
      markets_resolved: Number(r?.markets_resolved ?? 0),
      markets_voided: Number(r?.markets_voided ?? 0),
      unique_traders: Number(r?.unique_traders ?? 0),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
