// toggle_user_freeze wrapper.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const { user_id, frozen } = (await req.json()) as { user_id: string; frozen: boolean };

    if (!user_id || typeof frozen !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields: user_id, frozen" },
        { status: 400 }
      );
    }

    await runAs(admin.id, async (tx) => {
      await tx.execute(sql`SELECT toggle_user_freeze(${user_id}::uuid, ${frozen}::boolean)`);
    });

    return NextResponse.json({ success: true, user_id, is_frozen: frozen });
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("toggle_user_freeze failed", { source: "api/admin/users/freeze" }, err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
