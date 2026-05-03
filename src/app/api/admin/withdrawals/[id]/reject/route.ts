// POST /api/admin/withdrawals/[id]/reject  body: { notes?: string }
// Refunds the held debit + sets status='rejected'.
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
    const body = await req.json().catch(() => ({}));
    const notes = body.notes ? String(body.notes) : null;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<{ result: unknown }>(
        sql`SELECT admin_reject_withdrawal(${id}::uuid, ${notes}::text) AS result`
      );
    });

    return NextResponse.json(result.rows[0]?.result ?? { ok: true });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reject failed" },
      { status: 400 }
    );
  }
}
