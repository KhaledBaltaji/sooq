// admin_set_admin_role wrapper — super admin only.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const { user_id, is_admin, allowed_views } = (await req.json()) as {
      user_id: string;
      is_admin: boolean;
      allowed_views?: string[] | null;
    };

    if (!user_id || typeof is_admin !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields: user_id, is_admin" },
        { status: 400 }
      );
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: unknown }>(sql`
        SELECT (admin_set_admin_role(
          ${user_id}::uuid,
          ${is_admin}::boolean,
          ${allowed_views ?? null}::text[]
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: unknown } | undefined)?.result ?? null;
    });

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("admin_set_admin_role failed", { source: "api/admin/users/role" }, err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
