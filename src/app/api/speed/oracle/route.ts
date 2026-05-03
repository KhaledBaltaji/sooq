// GET /api/speed/oracle — latest oracle price per asset. Public.
// Used by the live tail of the speed market chart + trade panel.
// Polled at 2s.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedOracleLatest } from "@/lib/db/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset");

  const query = db.select().from(speedOracleLatest);
  const rows = asset
    ? await query.where(eq(speedOracleLatest.asset, asset))
    : await query;

  return NextResponse.json({
    oracle: rows.map((r) => ({
      asset: r.asset,
      price: Number(r.price),
      received_at: r.receivedAt.toISOString(),
    })),
  });
}
