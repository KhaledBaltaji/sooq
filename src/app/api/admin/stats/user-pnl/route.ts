// GET /api/admin/stats/user-pnl?sort=winners|losers|volume&limit=20
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const ALLOWED_SORTS = ["winners", "losers", "volume"] as const;

interface UserPnlRow {
  [key: string]: unknown;
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  position_count: number;
  total_stakes: string;
  total_payouts: string;
  net_pnl: string;
  open_positions: number;
  open_stake_total: string;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdminApi();
    const url = new URL(req.url);
    const sortParam = url.searchParams.get("sort") ?? "winners";
    const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const sort = (ALLOWED_SORTS as readonly string[]).includes(sortParam)
      ? sortParam
      : "winners";
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(100, limitParam))
      : 20;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<UserPnlRow>(
        sql`SELECT * FROM get_stats_user_pnl(${limit}::int, ${sort}::text)`
      );
    });

    return NextResponse.json({
      users: result.rows.map((r) => ({
        user_id: r.user_id,
        email: r.email,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        position_count: Number(r.position_count),
        total_stakes: Number(r.total_stakes),
        total_payouts: Number(r.total_payouts),
        net_pnl: Number(r.net_pnl),
        open_positions: Number(r.open_positions),
        open_stake_total: Number(r.open_stake_total),
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
