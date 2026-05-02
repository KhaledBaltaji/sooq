import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { otpVerifications } from "@/lib/db/schema";
import { sendWhatsAppOTP } from "@/lib/verifyway";
import { logger } from "@/lib/logger";

// W7 cutover: Drizzle-backed OTP issuance. The Auth.js whatsapp-otp
// Credentials provider (src/lib/auth/whatsapp-otp-provider.ts) is the
// matching verify-side — this route only issues codes.

function hashOTP(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(request: Request) {
  try {
    const { phone } = await request.json();

    if (!phone || typeof phone !== "string" || !/^\+\d{10,15}$/.test(phone)) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Per-phone rate limit: max 3 OTPs / 5 min.
    const phoneCountRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.phone, phone),
          gte(otpVerifications.createdAt, fiveMinAgo)
        )
      );
    if ((phoneCountRows[0]?.count ?? 0) >= 3) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait a few minutes." },
        { status: 429 }
      );
    }

    // Per-IP rate limit: max 10 OTPs / 5 min (spray protection).
    if (clientIp !== "unknown") {
      const ipCountRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(otpVerifications)
        .where(
          and(
            eq(otpVerifications.ip, clientIp),
            gte(otpVerifications.createdAt, fiveMinAgo)
          )
        );
      if ((ipCountRows[0]?.count ?? 0) >= 10) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a few minutes." },
          { status: 429 }
        );
      }
    }

    // Generate fresh 6-digit code.
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = hashOTP(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Invalidate any existing un-verified OTPs for this phone (prevent
    // multiple live codes racing the verifier).
    await db
      .delete(otpVerifications)
      .where(
        and(
          eq(otpVerifications.phone, phone),
          eq(otpVerifications.verified, false)
        )
      );

    const [inserted] = await db
      .insert(otpVerifications)
      .values({
        phone,
        codeHash,
        ip: clientIp,
        expiresAt,
      })
      .returning({ id: otpVerifications.id });

    // Deliver via VerifyWay WhatsApp.
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

    if (result.messageId && inserted?.id) {
      await db
        .update(otpVerifications)
        .set({ messageId: result.messageId })
        .where(eq(otpVerifications.id, inserted.id));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error(
      "Send OTP error",
      {
        source: "auth/send-otp",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
      },
      err
    );
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
