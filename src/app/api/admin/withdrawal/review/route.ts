import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { runAs } from "@/lib/db/run-as";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { sendSlackAlert } from "@/lib/slack";
import { logger } from "@/lib/logger";

// admin_review_withdrawal RPC wrapper. Auth gate (admin + PIN) lives
// inside the RPC; this route only adds:
//   * Auth.js session check (fail fast before the RPC call).
//   * Slack notification on approval so ops knows there's money to send.
//
// runAs() sets app.user_id so the RPC can verify is_admin = TRUE.

interface ReviewBody {
  withdrawal_id: string;
  action: "approve" | "reject";
  pin: string;
  notes?: string;
}

interface ReviewResult {
  status: "approved" | "rejected";
  withdrawal_id: string;
  amount?: number;
  refunded_amount?: number;
  new_balance?: number;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdminApi();
    const body = (await req.json()) as ReviewBody;
    const { withdrawal_id, action, pin, notes } = body;

    if (!withdrawal_id || !action || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: withdrawal_id, action, pin" },
        { status: 400 }
      );
    }
    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const data = await runAs(admin.id, async (tx) => {
      const r = await tx.execute<{ result: ReviewResult }>(sql`
        SELECT (admin_review_withdrawal(
          ${withdrawal_id}::uuid,
          ${action}::text,
          ${pin}::text,
          ${notes ?? null}::text
        ))::jsonb AS result
      `);
      return (r.rows[0] as { result: ReviewResult } | undefined)?.result ?? null;
    });

    if (!data) {
      return NextResponse.json({ error: "RPC returned no result" }, { status: 500 });
    }

    if (action === "approve" && data.amount !== undefined) {
      const msg = `Withdrawal approved — needs manual send. Amount: $${data.amount} — Withdrawal ID: ${withdrawal_id}`;
      sendSlackAlert([msg]).catch((err) =>
        logger.warn("Slack alert failed on withdrawal approval", {
          source: "api/admin/withdrawal/review",
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;

    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error(
      "Withdrawal review failed",
      { source: "api/admin/withdrawal/review", errorMessage },
      err
    );
    // RPC throws raise as Postgres errors — surface message directly.
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
