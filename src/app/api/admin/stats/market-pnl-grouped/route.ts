// GET /api/admin/stats/market-pnl-grouped?from=&to=&duration=
// Per-bucket platform P&L aggregated by (asset, duration). Replaces the
// scattered per-market view as the default for /admin/stats. Drilldown
// to individual markets uses /api/admin/stats/market-pnl with the same
// asset+duration scope.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const ALLOWED_DURATIONS = ["5m", "15m", "1h", "24h"] as const;

interface GroupedRow {
  [key: string]: unknown;
  asset: string;
  duration: string;
  markets_total: number;
  markets_resolved: number;
  markets_voided: number;
  total_positions: number;
  winners: number;
  losers: number;
  refunded: number;
  cashed_out: number;
  stakes_in: string;
  payouts_out: string;
  platform_net: string;
  cashout_premium: string;
  last_resolved_at: string | null;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const durationParam = url.searchParams.get("duration");

    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const duration =
      durationParam && (ALLOWED_DURATIONS as readonly string[]).includes(durationParam)
        ? durationParam
        : null;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<GroupedRow>(
        sql`SELECT * FROM get_stats_market_pnl_grouped(
          ${from ? from.toISOString() : null}::timestamptz,
          ${to ? to.toISOString() : null}::timestamptz,
          ${duration}::text
        )`
      );
    });

    return NextResponse.json({
      buckets: result.rows.map((r) => ({
        asset: r.asset,
        duration: r.duration,
        markets_total: Number(r.markets_total),
        markets_resolved: Number(r.markets_resolved),
        markets_voided: Number(r.markets_voided),
        total_positions: Number(r.total_positions),
        winners: Number(r.winners),
        losers: Number(r.losers),
        refunded: Number(r.refunded),
        cashed_out: Number(r.cashed_out),
        stakes_in: Number(r.stakes_in),
        payouts_out: Number(r.payouts_out),
        platform_net: Number(r.platform_net),
        cashout_premium: Number(r.cashout_premium),
        last_resolved_at: r.last_resolved_at,
      })),
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
