// GET /api/speed/positions — current user's positions joined with market.
// Polled by use-speed-positions.

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { speedPositions, speedMarkets } from "@/lib/db/schema";

const STATUSES = ["open", "won", "lost", "cashed_out", "refunded"] as const;
type PositionStatus = (typeof STATUSES)[number];

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status: PositionStatus | null =
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as PositionStatus)
      : null;
  const marketId = url.searchParams.get("market_id");
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

  const conditions: SQL[] = [eq(speedPositions.userId, session.user.id)];
  if (status) conditions.push(eq(speedPositions.status, status));
  if (marketId) conditions.push(eq(speedPositions.marketId, marketId));

  const rows = await db
    .select({
      // position
      id: speedPositions.id,
      userId: speedPositions.userId,
      marketId: speedPositions.marketId,
      side: speedPositions.side,
      stake: speedPositions.stake,
      entryPrice: speedPositions.entryPrice,
      entryFairProb: speedPositions.entryFairProb,
      entryOfferedProb: speedPositions.entryOfferedProb,
      status: speedPositions.status,
      payoutAmount: speedPositions.payoutAmount,
      closedAt: speedPositions.closedAt,
      createdAt: speedPositions.createdAt,
      // market (joined)
      mkt_id: speedMarkets.id,
      mkt_asset: speedMarkets.asset,
      mkt_duration: speedMarkets.duration,
      mkt_strikePrice: speedMarkets.strikePrice,
      mkt_opensAt: speedMarkets.opensAt,
      mkt_closesAt: speedMarkets.closesAt,
      mkt_status: speedMarkets.status,
      mkt_outcome: speedMarkets.outcome,
      mkt_twapAtClose: speedMarkets.twapAtClose,
      mkt_voidReason: speedMarkets.voidReason,
      mkt_resolvedAt: speedMarkets.resolvedAt,
      mkt_createdAt: speedMarkets.createdAt,
    })
    .from(speedPositions)
    .leftJoin(speedMarkets, eq(speedPositions.marketId, speedMarkets.id))
    .where(and(...conditions))
    .orderBy(desc(speedPositions.createdAt))
    .limit(limit);

  return NextResponse.json({
    positions: rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      market_id: r.marketId,
      side: r.side,
      stake: Number(r.stake),
      entry_price: Number(r.entryPrice),
      entry_fair_prob: Number(r.entryFairProb),
      entry_offered_prob: Number(r.entryOfferedProb),
      status: r.status,
      payout_amount: r.payoutAmount ? Number(r.payoutAmount) : null,
      closed_at: r.closedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
      market: r.mkt_id
        ? {
            id: r.mkt_id,
            asset: r.mkt_asset,
            duration: r.mkt_duration,
            strike_price: r.mkt_strikePrice ? Number(r.mkt_strikePrice) : null,
            opens_at: r.mkt_opensAt?.toISOString() ?? null,
            closes_at: r.mkt_closesAt?.toISOString() ?? null,
            status: r.mkt_status,
            outcome: r.mkt_outcome,
            twap_at_close: r.mkt_twapAtClose ? Number(r.mkt_twapAtClose) : null,
            void_reason: r.mkt_voidReason,
            resolved_at: r.mkt_resolvedAt?.toISOString() ?? null,
            created_at: r.mkt_createdAt?.toISOString() ?? null,
          }
        : null,
    })),
  });
}
