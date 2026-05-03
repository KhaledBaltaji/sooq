// GET /api/admin/sidebar-counts — pending finance counts for the admin
// sidebar badges. Admin-only. Polled at 10s.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

interface SidebarCounts {
  pending_deposits: number;
  pending_withdrawals: number;
  pending_finance: number;
}

export async function GET() {
  try {
    const admin = await requireAdminApi();
    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: SidebarCounts }>(sql`
        SELECT (get_admin_sidebar_counts())::jsonb AS result
      `);
      return (r.rows[0] as { result: SidebarCounts } | undefined)?.result ?? null;
    });
    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("admin sidebar-counts failed", { source: "api/admin/sidebar-counts" }, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
