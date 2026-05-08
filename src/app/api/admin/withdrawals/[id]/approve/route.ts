// POST /api/admin/withdrawals/[id]/approve  body: { notes?: string }
//
// S0.16 (mig 0039): zod-validate id (UUID) and notes (length-bounded).
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { runAs } from "@/lib/db/run-as";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const idSchema = z.string().uuid("withdrawal id must be a UUID");
const bodySchema = z.object({ notes: z.string().max(500).optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminApi();
    const { id } = await params;
    const idResult = idSchema.safeParse(id);
    if (!idResult.success) {
      return NextResponse.json({ error: "Invalid withdrawal id" }, { status: 400 });
    }

    const rawBody = await req.json().catch(() => ({}));
    const bodyResult = bodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: bodyResult.error.issues.map((i) => i.message) },
        { status: 400 }
      );
    }
    const notes = bodyResult.data.notes ?? null;

    const result = await runAs(admin.id, async (tx) => {
      return tx.execute<{ result: unknown }>(
        sql`SELECT admin_approve_withdrawal(${idResult.data}::uuid, ${notes}::text) AS result`
      );
    });

    return NextResponse.json(result.rows[0]?.result ?? { ok: true });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approve failed" },
      { status: 400 }
    );
  }
}
