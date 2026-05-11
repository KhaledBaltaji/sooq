// GET /api/speed/positions/[id] — single position detail. User-scoped.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { speedPositions } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const rows = await db
    .select()
    .from(speedPositions)
    .where(and(eq(speedPositions.id, id), eq(speedPositions.userId, session.user.id)))
    .limit(1);
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(
    {
      position: {
        id: p.id,
        user_id: p.userId,
        market_id: p.marketId,
        side: p.side,
        stake: Number(p.stake),
        entry_price: Number(p.entryPrice),
        entry_fair_prob: Number(p.entryFairProb),
        entry_offered_prob: Number(p.entryOfferedProb),
        status: p.status,
        payout_amount: p.payoutAmount ? Number(p.payoutAmount) : null,
        closed_at: p.closedAt?.toISOString() ?? null,
        created_at: p.createdAt.toISOString(),
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" } },
  );
}
