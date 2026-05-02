import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";

// Use service role for webhook (not user-facing)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-whish-signature");

    // HMAC verification
    const hmacSecret = process.env.WHISH_WEBHOOK_SECRET;
    if (!hmacSecret) {
      logger.error("Whish webhook secret not configured — rejecting request", {
        source: "webhook/whish",
      });
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    const expectedSig = crypto
      .createHmac("sha256", hmacSecret)
      .update(body)
      .digest("hex");

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);

    // Expected payload: { user_id, amount, currency, tx_ref, status }
    const { user_id, amount, currency, tx_ref, status } = payload;

    if (status !== "confirmed") {
      return NextResponse.json({ status: "ignored" });
    }

    // Call process_deposit via service role (idempotent on provider_ref)
    const { data, error } = await supabase.rpc("process_deposit", {
      p_user_id: user_id,
      p_amount: amount,
      p_currency: currency || "LBP",
      p_provider_ref: tx_ref,
      p_provider: "whish",
    });

    if (error) {
      logger.error("Whish deposit processing failed", {
        source: "webhook/whish",
        userId: user_id,
        amount,
        currency: currency || "LBP",
        txRef: tx_ref,
        errorMessage: error.message,
        errorCode: error.code,
      });
      await sendSlackAlert([
        `Whish deposit FAILED: user=${user_id}, amount=${amount} ${currency || "LBP"}, txRef=${tx_ref}, error=${error.message}`,
      ]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info("Whish deposit processed", { source: "webhook/whish", userId: user_id, amount, txRef: tx_ref });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error("Whish webhook unhandled error", { source: "webhook/whish" }, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
