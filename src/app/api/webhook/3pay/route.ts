import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";
import type { ThreePayWebhookPayload } from "@/lib/3pay";

// Service role client for webhook processing (not user-facing)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("X-Webhook-Signature");

    // HMAC-SHA256 verification (3pay sends "sha256=<hex>" in X-Webhook-Signature)
    const hmacSecret = process.env.THREEPAY_WEBHOOK_SECRET;
    if (!hmacSecret) {
      logger.error("3pay webhook secret not configured — rejecting request", {
        source: "webhook/3pay",
      });
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    const expectedSig =
      "sha256=" +
      crypto.createHmac("sha256", hmacSecret).update(body).digest("hex");

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      logger.warn("3pay webhook signature mismatch", { source: "webhook/3pay" });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const envelope: ThreePayWebhookPayload = JSON.parse(body);

    // Log raw payload for debugging during initial integration
    logger.info("3pay webhook received", {
      source: "webhook/3pay",
      success: envelope.success,
      message: envelope.message,
    });

    // Validate envelope structure
    if (!envelope.data) {
      logger.error("3pay webhook: missing data field in payload", {
        source: "webhook/3pay",
      });
      return NextResponse.json({ error: "Invalid payload structure" }, { status: 400 });
    }

    const payload = envelope.data;

    // Only process deposit webhooks (ignore withdrawal/payout)
    if (payload.type !== "deposit") {
      return NextResponse.json({ status: "ignored", reason: `type: ${payload.type}` });
    }

    // Only process confirmed deposits
    if (payload.status !== "confirmed") {
      return NextResponse.json({ status: "ignored", reason: `status: ${payload.status}` });
    }

    // Resolve the user by walletAddress lookup in user_wallets
    let userId: string | null = null;

    if (payload.walletAddress) {
      const { data: wallet } = await supabase
        .from("user_wallets")
        .select("user_id")
        .or(
          `wallet_address_trc20.eq.${payload.walletAddress},wallet_address_erc20.eq.${payload.walletAddress}`
        )
        .single();

      if (wallet) {
        userId = wallet.user_id;
      }
    }

    if (!userId) {
      logger.error("3pay webhook: could not resolve user", {
        source: "webhook/3pay",
        transactionId: payload.transactionId,
        walletAddress: payload.walletAddress,
      });
      // Record orphaned deposit for admin reconciliation
      await supabase.from("deposits").insert({
        provider: "3pay",
        provider_ref: payload.transactionId,
        amount: payload.amount,
        currency: payload.currencyType?.split("-")[0] || "USDT",
        status: "pending_review",
        metadata: { walletAddress: payload.walletAddress, orphaned: true },
      }).then(() => {}, () => {}); // best-effort insert
      await sendSlackAlert([
        `3pay deposit: could not resolve user. txn=${payload.transactionId}, wallet=${payload.walletAddress}, amount=$${payload.amount}. Recorded as pending_review.`,
      ]);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Determine currency from currencyType (e.g. "USDT-TRC20" → "USDT")
    const currency = payload.currencyType
      ? payload.currencyType.split("-")[0]
      : "USDT";

    // Call process_deposit (idempotent via provider_ref = transactionId)
    const { data, error } = await supabase.rpc("process_deposit", {
      p_user_id: userId,
      p_amount: payload.amount,
      p_currency: currency,
      p_provider_ref: payload.transactionId,
      p_provider: "3pay",
    });

    if (error) {
      logger.error("3pay deposit processing failed", {
        source: "webhook/3pay",
        userId,
        amount: payload.amount,
        transactionId: payload.transactionId,
        errorMessage: error.message,
        errorCode: error.code,
      });
      await sendSlackAlert([
        `3pay deposit FAILED: user=${userId}, amount=$${payload.amount}, txn=${payload.transactionId}, error=${error.message}`,
      ]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // process_deposit is idempotent: if the same provider_ref arrives twice,
    // the RPC returns { status: 'already_processed' } instead of double-crediting.
    // Previously we logged success identically in both cases, which meant
    // duplicate webhook deliveries looked like a genuine second confirmation
    // in logs + could trigger downstream side-effects (realtime notify, etc).
    // Now we surface the distinction: still return 200 (3pay stops retrying)
    // but log as duplicate and skip the "processed" log so dashboards stay clean.
    const rpcStatus = (data as { status?: string } | null)?.status;
    if (rpcStatus === "already_processed") {
      logger.info("3pay webhook duplicate delivery (idempotent)", {
        source: "webhook/3pay",
        userId,
        transactionId: payload.transactionId,
      });
      return NextResponse.json({ success: true, duplicate: true, data });
    }

    logger.info("3pay deposit processed", {
      source: "webhook/3pay",
      userId,
      amount: payload.amount,
      transactionId: payload.transactionId,
      depositId: (data as { deposit_id?: string } | null)?.deposit_id,
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error("3pay webhook unhandled error", { source: "webhook/3pay" }, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
