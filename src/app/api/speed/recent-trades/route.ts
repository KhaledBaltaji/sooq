// GET /api/speed/recent-trades?limit=10
// Public. Calls public.get_recent_speed_trades(p_limit) — anonymized
// handles only, no PII (mig 0023). Powers the home-page Live Trade Tape.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(50, Math.max(1, rawLimit))
    : 10;

  const r = await db.execute<{
    trade_id: string;
    created_at: Date;
    side: "over" | "under";
    stake_usd: string;
    asset: string;
    duration: "5m" | "15m" | "1h" | "24h";
    who_handle: string;
  }>(sql`
    SELECT trade_id, created_at, side, stake_usd, asset, duration, who_handle
    FROM public.get_recent_speed_trades(${limit}::int)
  `);

  return NextResponse.json(
    {
      trades: r.rows.map((row) => ({
        trade_id: row.trade_id,
        created_at:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString(),
        side: row.side,
        stake_usd: Number(row.stake_usd),
        asset: row.asset,
        duration: row.duration,
        who_handle: row.who_handle,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=2, stale-while-revalidate=4",
      },
    },
  );
}
