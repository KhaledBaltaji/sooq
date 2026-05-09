// GET /api/admin/stats/daily-ngr
//
// Phase 5K — Sparkline data source for the Revenue tab. Returns last
// 14 days of platform NGR (sorted ascending by date so the sparkline
// renders left-to-right).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

interface NgrRow {
  ngr_date: string;
  ngr: string;
  stake_in: string;
  [key: string]: unknown;
}

export async function GET() {
  try {
    await requireAdminApi();
    const result = await db.execute<NgrRow>(sql`
      SELECT
        ngr_date::text AS ngr_date,
        ngr::text AS ngr,
        stake_in::text AS stake_in
      FROM speed_daily_ngr
      WHERE ngr_date >= (CURRENT_DATE - INTERVAL '13 days')::date
      ORDER BY ngr_date ASC
    `);

    return NextResponse.json({
      days: result.rows.map((r) => ({
        date: r.ngr_date,
        ngr: Number(r.ngr),
        stake_in: Number(r.stake_in),
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
