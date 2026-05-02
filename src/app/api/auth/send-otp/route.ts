import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppOTP } from "@/lib/verifyway";
import { logger } from "@/lib/logger";
import crypto from "crypto";

/** SHA-256 hash for OTP storage (never store plaintext) */
function hashOTP(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { phone } = await request.json();

    if (!phone || typeof phone !== "string" || !/^\+\d{10,15}$/.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Rate limit: max 3 OTPs per phone per 5 minutes
    const { count } = await serviceClient
      .from("otp_verifications")
      .select("*", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", fiveMinAgo);

    if (count && count >= 3) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait a few minutes." },
        { status: 429 }
      );
    }

    // Rate limit: max 10 OTPs per IP per 5 minutes (prevent spray attacks)
    if (clientIp !== "unknown") {
      const { count: ipCount } = await serviceClient
        .from("otp_verifications")
        .select("*", { count: "exact", head: true })
        .eq("ip", clientIp)
        .gte("created_at", fiveMinAgo);

      if (ipCount && ipCount >= 10) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a few minutes." },
          { status: 429 }
        );
      }
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete existing unexpired OTPs for this phone
    await serviceClient
      .from("otp_verifications")
      .delete()
      .eq("phone", phone)
      .eq("verified", false);

    // Insert new OTP record (5-minute expiry, code stored as SHA-256 hash)
    const hashedCode = hashOTP(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: insertError } = await serviceClient
      .from("otp_verifications")
      .insert({ phone, code: hashedCode, ip: clientIp, expires_at: expiresAt });

    if (insertError) {
      logger.error("Failed to store OTP", {
        source: "auth/send-otp",
        errorMessage: insertError.message,
      });
      return NextResponse.json(
        { error: "Failed to send code. Please try again." },
        { status: 500 }
      );
    }

    // Deliver via VerifyWay WhatsApp
    const result = await sendWhatsAppOTP(phone, code, "en");

    if (!result.success) {
      logger.error("VerifyWay delivery failed", {
        source: "auth/send-otp",
        phone,
        errorMessage: result.error,
      });
      return NextResponse.json(
        { error: "Failed to send WhatsApp message. Please try again." },
        { status: 500 }
      );
    }

    // Store message_id for delivery tracking
    if (result.messageId) {
      await serviceClient
        .from("otp_verifications")
        .update({ message_id: result.messageId })
        .eq("phone", phone)
        .eq("code", hashedCode);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Send OTP error", {
      source: "auth/send-otp",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
