// GET /api/speed/volatility?asset=BTC — current realized vol (or fallback).
// Public. Calls get_speed_volatility RPC. v1 always returns the fallback
// path (reads fee_config.speed_iv_btc).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";

  const r = await db.execute<{ result: { rv: number; computed_at: string; source: string } }>(sql`
    SELECT (get_speed_volatility(${asset}::text))::jsonb AS result
  `);
  const data = (r.rows[0] as { result: { rv: number; computed_at: string; source: string } } | undefined)?.result;

  if (!data) {
    return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
  }

  return NextResponse.json(data);
}
