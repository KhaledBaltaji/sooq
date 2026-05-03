// POST /api/admin/withdrawals/[id]/mark-sent
// body: { external_reference: string, notes?: string }
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminApi();
    const { id } = await params;
    const body = await req.json();
    const externalRef = String(body.external_reference ?? "").trim();
    const notes = body.notes ? String(body.notes) : null;

    if (!externalRef) {
      return NextResponse.json(
        { error: "external_reference is required" },
        { status: 400 }
      );
    }

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<{ result: unknown }>(
        sql`SELECT admin_mark_withdrawal_sent_v2(
          ${id}::uuid,
          ${externalRef}::text,
          ${notes}::text
        ) AS result`
      );
    });

    return NextResponse.json(result.rows[0]?.result ?? { ok: true });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mark sent failed" },
      { status: 400 }
    );
  }
}
