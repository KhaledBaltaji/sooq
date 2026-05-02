// Custom Auth.js Credentials provider for WhatsApp OTP via VerifyWay.
//
// Flow:
//   1. User enters phone number on signup form.
//   2. Frontend POSTs phone to /api/auth/send-otp (existing route, untouched).
//      That route stores a hashed code in `otp_verifications` and asks
//      VerifyWay to deliver via WhatsApp.
//   3. User enters the 6-digit code in the next step.
//   4. Frontend calls signIn("whatsapp-otp", { phone, code }).
//   5. This provider validates the code against `otp_verifications`,
//      finds-or-creates the user row, and returns it. Auth.js issues
//      the session.

import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { otpVerifications, users } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { createHash } from "crypto";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export const whatsappOtpProvider = Credentials({
  id: "whatsapp-otp",
  name: "WhatsApp OTP",
  credentials: {
    phone: { label: "Phone", type: "tel" },
    code: { label: "OTP code", type: "text" },
  },
  async authorize(credentials) {
    const phone = (credentials?.phone as string)?.trim();
    const code = (credentials?.code as string)?.trim();
    if (!phone || !code) return null;

    const codeHash = hashCode(code);

    // Look up the most recent un-verified row for this phone+codehash that hasn't expired.
    const rows = await db
      .select()
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.phone, phone),
          eq(otpVerifications.codeHash, codeHash),
          eq(otpVerifications.verified, false),
          gt(otpVerifications.expiresAt, new Date())
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Mark as verified so it can't be re-used.
    await db
      .update(otpVerifications)
      .set({ verified: true })
      .where(eq(otpVerifications.id, row.id));

    // Find-or-create user by phone.
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);

    let user = existingUsers[0];
    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          phone,
          name: phone, // placeholder; user can set displayName later in /settings
          locale: "en",
        })
        .returning();
      user = newUser;
    }

    return {
      id: user.id,
      name: user.name ?? user.displayName ?? phone,
      email: user.email ?? null,
      image: user.image ?? user.avatarUrl ?? null,
    };
  },
});
