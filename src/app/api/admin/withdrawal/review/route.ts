import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { logger } from "@/lib/logger";

// Thin wrapper over admin_review_withdrawal RPC that adds a Slack alert on
// approval so ops team knows there's a withdrawal waiting to be sent externally.
// Auth is enforced inside the RPC (checks auth.uid() + is_admin + PIN).
// This route just routes the call server-side and handles the Slack notification.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { withdrawal_id, action, pin } = body;

    if (!withdrawal_id || !action || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: withdrawal_id, action, pin" },
        { status: 400 }
      );
    }
    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const supabase = await createClient();

    // Auth check (RPC also enforces, but fail fast)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("admin_review_withdrawal" as never, {
      p_withdrawal_id: withdrawal_id,
      p_action: action,
      p_pin: pin,
    } as never);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Fire-and-forget Slack alert on approve — ops team needs to actually send the money.
    if (action === "approve" && data && typeof data === "object") {
      const d = data as {
        status?: string;
        amount?: number;
        net_amount?: number;
        destination?: string;
        provider?: string;
      };
      const msg = [
        `Withdrawal approved — needs manual send`,
        `Amount: $${d.net_amount?.toFixed(2) ?? "?"} (gross $${d.amount?.toFixed(2) ?? "?"})`,
        `Provider: ${d.provider ?? "?"}`,
        `Destination: \`${d.destination ?? "?"}\``,
        `Withdrawal ID: ${withdrawal_id}`,
      ].join(" — ");
      // Don't await — errors logged inside sendSlackAlert.
      sendSlackAlert([msg]).catch((err) =>
        logger.warn("Slack alert failed on withdrawal approval", {
          source: "api/admin/withdrawal/review",
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    logger.error("Withdrawal review failed", { source: "api/admin/withdrawal/review" }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
