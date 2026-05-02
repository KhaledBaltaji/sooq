// admin_set_pin (POST) + admin_has_pin (GET) wrappers.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const admin = await requireAdminApi();
    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ has_pin: boolean }>(sql`SELECT admin_has_pin() AS has_pin`);
      return Boolean((r.rows[0] as { has_pin?: boolean } | undefined)?.has_pin);
    });
    return NextResponse.json({ has_pin: data });
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    logger.error("admin_has_pin failed", { source: "api/admin/pin" }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const { pin } = (await req.json()) as { pin: string };

    if (!pin) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 });
    }

    await runAs(admin.id, async (tx) => {
      await tx.execute(sql`SELECT admin_set_pin(${pin}::text)`);
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error("admin_set_pin failed", { source: "api/admin/pin", errorMessage: msg }, err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
