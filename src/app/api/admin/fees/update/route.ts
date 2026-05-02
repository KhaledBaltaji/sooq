// admin_update_fee wrapper.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const { fee_type, rate, pin } = (await req.json()) as {
      fee_type: string;
      rate: number;
      pin: string;
    };

    if (!fee_type || rate === undefined || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: fee_type, rate, pin" },
        { status: 400 }
      );
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: unknown }>(sql`
        SELECT (admin_update_fee(
          ${fee_type}::text,
          ${rate}::numeric,
          ${pin}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: unknown } | undefined)?.result ?? null;
    });

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("admin_update_fee failed", { source: "api/admin/fees/update" }, err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
