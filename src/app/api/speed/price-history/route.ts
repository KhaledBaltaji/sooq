// GET /api/speed/price-history?asset=BTC&from=<iso>&to=<iso>&max_points=500
// Public. Calls get_speed_price_history RPC (defined in 0007_chart_rpcs.sql).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const maxPoints = parseInt(url.searchParams.get("max_points") ?? "500", 10);

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "missing `from` and `to` ISO timestamps" },
      { status: 400 }
    );
  }
  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid timestamp" }, { status: 400 });
  }

  const r = await db.execute<{ ts: Date; price: string }>(sql`
    SELECT ts, price
    FROM get_speed_price_history(${asset}::text, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, ${maxPoints}::int)
  `);

  return NextResponse.json({
    points: (r.rows as Array<{ ts: Date; price: string }>).map((row) => ({
      ts: row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts).toISOString(),
      price: Number(row.price),
    })),
  });
}
