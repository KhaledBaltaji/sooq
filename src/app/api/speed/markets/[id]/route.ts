// GET /api/speed/markets/[id] — single market detail. Public.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedMarkets } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const rows = await db.select().from(speedMarkets).where(eq(speedMarkets.id, id)).limit(1);
  const m = rows[0];
  if (!m) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    market: {
      id: m.id,
      asset: m.asset,
      duration: m.duration,
      strike_price: m.strikePrice ? Number(m.strikePrice) : null,
      opens_at: m.opensAt.toISOString(),
      closes_at: m.closesAt.toISOString(),
      status: m.status,
      outcome: m.outcome,
      twap_at_close: m.twapAtClose ? Number(m.twapAtClose) : null,
      void_reason: m.voidReason,
      resolved_at: m.resolvedAt?.toISOString() ?? null,
      created_at: m.createdAt.toISOString(),
    },
  });
}
