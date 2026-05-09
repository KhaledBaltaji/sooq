// GET /api/admin/stats/user-activity?from=&to=
//
// Phase 5K — Users tab activity KPIs. DAU = distinct users with a
// speed_* transaction in last 24h. WAU = same, last 7 days. Range-only
// affects new_signups; DAU/WAU are rolling.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

interface ActivityRow {
  total_users: string;
  dau: string;
  wau: string;
  new_signups: string;
  currently_shaded: string;
  [key: string]: unknown;
}

export async function GET(req: Request) {
  try {
    await requireAdminApi();
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const fromIso = from ? from.toISOString() : null;
    const toIso = to ? to.toISOString() : null;

    // currently_shaded mirrors the same gate /admin/sharks renders client-side:
    // settled_trades >= min AND ci_low > min_ci_low AND CLV throttle enabled
    // AND last_recomputed_at within max_age_h. We approximate inline with
    // sane defaults (30 / 0.02 / 36h) — a small over/under count is fine; the
    // page already shows the precise count via /admin/sharks.
    const result = await db.execute<ActivityRow>(sql`
      SELECT
        (SELECT COUNT(*)::text FROM users) AS total_users,
        (SELECT COUNT(DISTINCT user_id)::text
           FROM transactions
          WHERE created_at > NOW() - INTERVAL '1 day'
            AND type::text LIKE 'speed_%'
        ) AS dau,
        (SELECT COUNT(DISTINCT user_id)::text
           FROM transactions
          WHERE created_at > NOW() - INTERVAL '7 days'
            AND type::text LIKE 'speed_%'
        ) AS wau,
        (SELECT COUNT(*)::text
           FROM users
          WHERE (${fromIso}::timestamptz IS NULL OR created_at >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR created_at <= ${toIso}::timestamptz)
        ) AS new_signups,
        (SELECT COUNT(*)::text
           FROM speed_user_edge_scores
          WHERE settled_trades >= 30
            AND ci_low > 0.02
            AND last_recomputed_at > NOW() - INTERVAL '36 hours'
        ) AS currently_shaded
    `);

    const r = result.rows[0];
    return NextResponse.json({
      total_users: Number(r?.total_users ?? 0),
      dau: Number(r?.dau ?? 0),
      wau: Number(r?.wau ?? 0),
      new_signups: Number(r?.new_signups ?? 0),
      currently_shaded: Number(r?.currently_shaded ?? 0),
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
