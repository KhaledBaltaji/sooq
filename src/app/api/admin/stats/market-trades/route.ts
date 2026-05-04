// GET /api/admin/stats/market-trades
//   ?market_id=<uuid>            → all trades for that market (date filter ignored)
//   ?asset=BTC&duration=5m&from=&to=&limit=  → all trades in bucket within range
//
// Powers the level-2 drilldown on /admin/stats — the trade history view
// you reach by clicking a specific market inside a bucket sheet.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const ALLOWED_DURATIONS = ["5m", "15m", "1h", "24h"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TradeRow {
  [key: string]: unknown;
  trade_id: string;
  kind: string;
  amount: string;
  created_at: string;
  market_id: string;
  market_asset: string;
  market_duration: string;
  market_opens_at: string;
  market_closes_at: string;
  market_status: string;
  market_outcome: string | null;
  position_id: string;
  position_side: string;
  position_stake: string;
  entry_offered_prob: string;
  payout_amount: string | null;
  position_status: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const assetParam = url.searchParams.get("asset");
    const durationParam = url.searchParams.get("duration");
    const marketIdParam = url.searchParams.get("market_id");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const limitParam = url.searchParams.get("limit");

    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const marketId = marketIdParam && UUID_RE.test(marketIdParam) ? marketIdParam : null;
    if (marketIdParam && !marketId) {
      return NextResponse.json({ error: "Invalid market_id" }, { status: 400 });
    }

    const asset = assetParam ? assetParam.toUpperCase().slice(0, 16) : null;
    const duration =
      durationParam && (ALLOWED_DURATIONS as readonly string[]).includes(durationParam)
        ? durationParam
        : null;

    const limit = limitParam ? Math.max(1, Math.min(1000, Number(limitParam) || 500)) : 500;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<TradeRow>(
        sql`SELECT * FROM get_stats_market_trades(
          ${asset}::text,
          ${duration}::text,
          ${marketId}::uuid,
          ${from ? from.toISOString() : null}::timestamptz,
          ${to ? to.toISOString() : null}::timestamptz,
          ${limit}::int
        )`
      );
    });

    return NextResponse.json({
      trades: result.rows.map((r) => ({
        trade_id: r.trade_id,
        kind: r.kind,
        amount: Number(r.amount),
        created_at: r.created_at,
        market_id: r.market_id,
        market_asset: r.market_asset,
        market_duration: r.market_duration,
        market_opens_at: r.market_opens_at,
        market_closes_at: r.market_closes_at,
        market_status: r.market_status,
        market_outcome: r.market_outcome,
        position_id: r.position_id,
        position_side: r.position_side,
        position_stake: Number(r.position_stake),
        entry_offered_prob: Number(r.entry_offered_prob),
        payout_amount: r.payout_amount === null ? null : Number(r.payout_amount),
        position_status: r.position_status,
        user_id: r.user_id,
        user_email: r.user_email,
        user_display_name: r.user_display_name,
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
