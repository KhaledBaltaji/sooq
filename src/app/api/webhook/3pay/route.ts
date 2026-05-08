import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deposits } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";
import type { ThreePayWebhookPayload } from "@/lib/3pay/types";

// 3pay webhook → process_deposit RPC.
//
// Flow:
//   1. HMAC-SHA256 verify signature with THREEPAY_WEBHOOK_SECRET.
//   2. Filter: only confirmed deposits (ignore withdrawal/payout/pending).
//   3. Resolve user via `clientId` field — this is the userId we sent to
//      3pay when generating their wallet (echoed back on every webhook).
//   4. Idempotent process_deposit RPC. Re-deliveries return
//      { status: 'already_processed' }.
//
// Service-role mode: this route does NOT call runAs(), so `app.user_id()`
// inside process_deposit returns NULL — that's our trusted-caller signal.

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("X-Webhook-Signature");

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

    logger.info("3pay webhook received", {
      source: "webhook/3pay",
      success: envelope.success,
      message: envelope.message,
    });

    if (!envelope.data) {
      logger.error("3pay webhook: missing data field in payload", {
        source: "webhook/3pay",
      });
      return NextResponse.json({ error: "Invalid payload structure" }, { status: 400 });
    }

    const payload = envelope.data;

    if (payload.type !== "deposit") {
      return NextResponse.json({ status: "ignored", reason: `type: ${payload.type}` });
    }

    if (payload.status !== "confirmed") {
      return NextResponse.json({ status: "ignored", reason: `status: ${payload.status}` });
    }

    const userId = payload.clientId;

    if (!userId) {
      logger.error("3pay webhook: no clientId in payload", {
        source: "webhook/3pay",
        transactionId: payload.transactionId,
        walletAddress: payload.walletAddress,
      });
      // Orphan record so ops can reconcile manually. providerRef must still
      // be unique — if 3pay redelivers, the unique constraint stops a dupe.
      await db
        .insert(deposits)
        .values({
          userId: "00000000-0000-0000-0000-000000000000",
          provider: "3pay",
          providerRef: payload.transactionId,
          amount: String(payload.amount),
          currency: payload.currencyType?.split("-")[0] || "USDT",
          status: "pending",
          rawPayload: payload as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing();
      await sendSlackAlert([
        `3pay deposit: missing clientId. txn=${payload.transactionId}, wallet=${payload.walletAddress}, amount=$${payload.amount}. Recorded as pending.`,
      ]);
      return NextResponse.json({ error: "User not identified" }, { status: 404 });
    }

    const currency = payload.currencyType
      ? payload.currencyType.split("-")[0]
      : "USDT";

    try {
      const result = await db.execute<{
        deposit_id: string;
        amount: number;
        new_balance: number;
        status: string;
      }>(sql`SELECT (process_deposit(
        ${userId}::uuid,
        ${payload.amount}::numeric,
        ${currency}::text,
        ${payload.transactionId}::text,
        '3pay'::text
      ))::jsonb AS result`);

      const data = (result.rows[0] as unknown as { result: { status?: string; deposit_id?: string } } | undefined)?.result;

      if (data?.status === "already_processed") {
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
        depositId: data?.deposit_id,
      });

      return NextResponse.json({ success: true, data });
    } catch (rpcErr) {
      const errorMessage = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      // S0.8: log full context server-side ONLY. The webhook caller (3pay's
      // logs) gets a generic message — never user IDs, internal RPC errors,
      // or details that help craft a valid replay payload.
      logger.error("3pay deposit processing failed", {
        source: "webhook/3pay",
        userId,
        amount: payload.amount,
        transactionId: payload.transactionId,
        errorMessage,
      });
      await sendSlackAlert([
        `3pay deposit FAILED: user=${userId}, amount=$${payload.amount}, txn=${payload.transactionId}, error=${errorMessage}`,
      ]);
      return NextResponse.json({ error: "Deposit processing failed" }, { status: 500 });
    }
  } catch (err) {
    logger.error("3pay webhook unhandled error", { source: "webhook/3pay" }, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
