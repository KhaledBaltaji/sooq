// GET /api/speed/volatility?asset=BTC&duration=5m — current realized vol.
//
// Mig 0057: function now reads speed_volatility_cache via _speed_get_iv,
// so the value matches what speed_execute_trade will check at parity time.
// Optional `duration` param defaults to '5m' for backward compat with
// callers that don't yet specify (the new 1m UI passes 1m explicitly).
//
// Public.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const ALLOWED_DURATIONS = new Set(["1m", "5m", "15m", "1h", "24h"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";
  const rawDuration = url.searchParams.get("duration");
  const duration = rawDuration && ALLOWED_DURATIONS.has(rawDuration) ? rawDuration : "5m";

  const r = await db.execute<{ result: { rv: number; computed_at: string; source: string } }>(sql`
    SELECT (get_speed_volatility(${asset}::text, ${duration}::speed_duration))::jsonb AS result
  `);
  const data = (r.rows[0] as { result: { rv: number; computed_at: string; source: string } } | undefined)?.result;

  if (!data) {
    return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
  }

  return NextResponse.json(data);
}
