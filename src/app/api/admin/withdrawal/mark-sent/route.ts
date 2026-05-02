import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { logger } from "@/lib/logger";

// Wraps admin_mark_withdrawal_sent RPC. Called after ops has manually sent
// the money externally (Whish app, bank wire, or 3pay payout). Records the
// external reference id (tx hash / whish id / wire ref) and transitions
// approved → sent. PIN-gated. Sends Slack confirmation so the team knows
// the transfer cycle is closed.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { withdrawal_id, external_reference_id, pin } = body;

    if (!withdrawal_id || !external_reference_id || !pin) {
      return NextResponse.json(
        { error: "Missing required fields: withdrawal_id, external_reference_id, pin" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("admin_mark_withdrawal_sent" as never, {
      p_withdrawal_id: withdrawal_id,
      p_external_reference_id: external_reference_id,
      p_pin: pin,
    } as never);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Fire-and-forget Slack confirmation
    const msg = `Withdrawal marked sent — ref: \`${external_reference_id}\` — withdrawal ID: ${withdrawal_id}`;
    sendSlackAlert([msg]).catch((err) =>
      logger.warn("Slack alert failed on withdrawal mark-sent", {
        source: "api/admin/withdrawal/mark-sent",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    );

    return NextResponse.json(data);
  } catch (err) {
    logger.error("Withdrawal mark-sent failed", { source: "api/admin/withdrawal/mark-sent" }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
