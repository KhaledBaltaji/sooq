// GET /api/admin/stats/market-pnl?from=&to=&duration=
// Per-market platform P&L for the date range.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

// Admin allows historical durations (15m/24h) as filter values so old data is
// still queryable; new markets are 5m+1h only (mig 0028+).
const ALLOWED_DURATIONS = ["5m", "15m", "1h", "24h"] as const;

interface MarketPnlRow {
  [key: string]: unknown;
  market_id: string;
  asset: string;
  duration: string;
  opens_at: string;
  closes_at: string;
  resolved_at: string | null;
  status: string;
  outcome: string | null;
  twap_at_close: string | null;
  total_positions: number;
  winners: number;
  losers: number;
  refunded: number;
  cashed_out: number;
  stakes_in: string;
  payouts_out: string;
  platform_net: string;
  cashout_premium: string;
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
      return tx.execute<MarketPnlRow>(
        sql`SELECT * FROM get_stats_market_pnl(
          ${from ? from.toISOString() : null}::timestamptz,
          ${to ? to.toISOString() : null}::timestamptz,
          ${duration}::text
        )`
      );
    });

    return NextResponse.json({
      markets: result.rows.map((r) => ({
        market_id: r.market_id,
        asset: r.asset,
        duration: r.duration,
        opens_at: r.opens_at,
        closes_at: r.closes_at,
        resolved_at: r.resolved_at,
        status: r.status,
        outcome: r.outcome,
        twap_at_close: r.twap_at_close ? Number(r.twap_at_close) : null,
        total_positions: Number(r.total_positions),
        winners: Number(r.winners),
        losers: Number(r.losers),
        refunded: Number(r.refunded),
        cashed_out: Number(r.cashed_out),
        stakes_in: Number(r.stakes_in),
        payouts_out: Number(r.payouts_out),
        platform_net: Number(r.platform_net),
        cashout_premium: Number(r.cashout_premium),
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
