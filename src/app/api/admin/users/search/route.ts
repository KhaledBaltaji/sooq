// GET /api/admin/users/search?q=… — admin-only user search by display_name
// or phone. Returns 10 results max with is_admin + admin_allowed_views so
// the AddAdminDialog can decide which role the user already has.

import { NextResponse } from "next/server";
import { ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    await requireAdminApi();
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const pattern = `%${query}%`;
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        display_name: users.displayName,
        phone: users.phone,
        avatar_url: users.avatarUrl,
        balance_usd: users.balanceUsd,
        is_admin: users.isAdmin,
        is_frozen: users.isFrozen,
        admin_allowed_views: users.adminAllowedViews,
      })
      .from(users)
      .where(
        or(
          ilike(sql`coalesce(${users.email}, '')`, pattern),
          ilike(sql`coalesce(${users.displayName}, '')`, pattern),
          ilike(sql`coalesce(${users.phone}, '')`, pattern)
        )
      )
      .limit(10);

    return NextResponse.json({
      users: rows.map((u) => ({
        ...u,
        balance_usd: Number(u.balance_usd ?? 0),
      })),
    });
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    logger.error("user search failed", { source: "api/admin/users/search" }, err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
