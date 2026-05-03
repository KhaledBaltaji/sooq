// GET /api/speed/klines?asset=BTC&from=<iso>&to=<iso>&max_buckets=200
// Public. Calls get_speed_klines RPC (synthesized OHLC from ticks).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const maxBuckets = parseInt(url.searchParams.get("max_buckets") ?? "200", 10);

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

  const r = await db.execute<{ bucket_time: Date; o: string; h: string; l: string; c: string }>(sql`
    SELECT bucket_time, o, h, l, c
    FROM get_speed_klines(${asset}::text, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, ${maxBuckets}::int)
  `);

  return NextResponse.json({
    candles: (r.rows as Array<{ bucket_time: Date; o: string; h: string; l: string; c: string }>).map((row) => ({
      ts: row.bucket_time instanceof Date ? row.bucket_time.toISOString() : new Date(row.bucket_time).toISOString(),
      o: Number(row.o),
      h: Number(row.h),
      l: Number(row.l),
      c: Number(row.c),
    })),
  });
}
