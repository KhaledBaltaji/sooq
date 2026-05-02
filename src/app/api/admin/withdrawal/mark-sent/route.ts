import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { sendSlackAlert } from "@/lib/slack";
import { logger } from "@/lib/logger";

// admin_mark_withdrawal_sent RPC wrapper. Records the external reference
// (whish tx id, blockchain tx hash, bank wire ref) and transitions the
// withdrawal: approved → sent. PIN-gated server-side.

interface MarkSentBody {
  withdrawal_id: string;
  external_reference_id: string;
  pin: string;
}

interface MarkSentResult {
  status: string;
  withdrawal_id: string;
  external_reference: string;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const body = (await req.json()) as MarkSentBody;
    const { withdrawal_id, external_reference_id, pin } = body;

    if (!withdrawal_id || !external_reference_id || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: withdrawal_id, external_reference_id, pin" },
        { status: 400 }
      );
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: MarkSentResult }>(sql`
        SELECT (admin_mark_withdrawal_sent(
          ${withdrawal_id}::uuid,
          ${external_reference_id}::text,
          ${pin}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: MarkSentResult } | undefined)?.result ?? null;
    });

    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }

    const msg = `Withdrawal marked sent — ref: \`${external_reference_id}\` — withdrawal ID: ${withdrawal_id}`;
    sendSlackAlert([msg]).catch((err) =>
      logger.warn("Slack alert failed on withdrawal mark-sent", {
        source: "api/admin/withdrawal/mark-sent",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    );

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;

    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error(
      "Withdrawal mark-sent failed",
      { source: "api/admin/withdrawal/mark-sent", errorMessage },
      err
    );
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
