import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";

// Whish webhook → process_deposit RPC.
// Service-role mode: no runAs(), no `app.user_id` GUC, RPC's auth gate
// allows the call because the GUC is unset.
//
// Expected payload (set on the Whish merchant side):
//   { user_id, amount, currency, tx_ref, status }

interface WhishPayload {
  user_id: string;
  amount: number;
  currency?: string;
  tx_ref: string;
  status: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-whish-signature");

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

    const payload = JSON.parse(body) as WhishPayload;
    const { user_id, amount, currency, tx_ref, status } = payload;

    if (status !== "confirmed") {
      return NextResponse.json({ status: "ignored" });
    }

    if (!user_id || !tx_ref || !amount) {
      logger.error("Whish webhook: missing required fields", {
        source: "webhook/whish",
        hasUserId: Boolean(user_id),
        hasTxRef: Boolean(tx_ref),
        hasAmount: Boolean(amount),
      });
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    try {
      const result = await db.execute<{
        result: { status?: string; deposit_id?: string };
      }>(sql`SELECT (process_deposit(
        ${user_id}::uuid,
        ${amount}::numeric,
        ${currency || "LBP"}::text,
        ${tx_ref}::text,
        'whish'::text
      ))::jsonb AS result`);

      const data = (result.rows[0] as unknown as { result: { status?: string; deposit_id?: string } } | undefined)?.result;

      if (data?.status === "already_processed") {
        logger.info("Whish webhook duplicate delivery (idempotent)", {
          source: "webhook/whish",
          userId: user_id,
          txRef: tx_ref,
        });
        return NextResponse.json({ success: true, duplicate: true, data });
      }

      logger.info("Whish deposit processed", {
        source: "webhook/whish",
        userId: user_id,
        amount,
        txRef: tx_ref,
      });
      return NextResponse.json({ success: true, data });
    } catch (rpcErr) {
      const errorMessage = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      logger.error("Whish deposit processing failed", {
        source: "webhook/whish",
        userId: user_id,
        amount,
        currency: currency || "LBP",
        txRef: tx_ref,
        errorMessage,
      });
      await sendSlackAlert([
        `Whish deposit FAILED: user=${user_id}, amount=${amount} ${
          currency || "LBP"
        }, txRef=${tx_ref}, error=${errorMessage}`,
      ]);
      // S0.8: generic message to webhook caller. Full context goes to
      // server logs + Slack only.
      return NextResponse.json({ error: "Deposit processing failed" }, { status: 500 });
    }
  } catch (err) {
    logger.error("Whish webhook unhandled error", { source: "webhook/whish" }, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
