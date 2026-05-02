import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { logger } from "@/lib/logger";
import { resolveAndApplyReferral } from "@/lib/auth/actions";
import crypto from "crypto";

const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Convert phone to synthetic email: +96171234567 → 96171234567@phone.sooq.exchange */
function phoneToSyntheticEmail(phone: string): string {
  return `${phone.replace("+", "")}@phone.sooq.exchange`;
}

/** SHA-256 hash for OTP comparison (codes stored hashed in DB) */
function hashOTP(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(request: Request) {
  try {
    const { phone, otp, referralCode, branchSlug, agentCode } = await request.json();

    if (!phone || !otp) {
      return NextResponse.json(
        { error: "Phone and OTP code are required" },
        { status: 400 }
      );
    }

    // --- Step 1: Verify OTP code ---

    // Find latest unexpired OTP for this phone
    const { data: otpRecord, error: otpError } = await serviceClient
      .from("otp_verifications")
      .select("*")
      .eq("phone", phone)
      .eq("verified", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError || !otpRecord) {
      return NextResponse.json(
        { error: "Code expired or not found. Please request a new one." },
        { status: 400 }
      );
    }

    // Check attempt limit
    if (otpRecord.attempts >= 5) {
      return NextResponse.json(
        { error: "Too many attempts. Please request a new code." },
        { status: 429 }
      );
    }

    // Increment attempts
    await serviceClient
      .from("otp_verifications")
      .update({ attempts: otpRecord.attempts + 1 })
      .eq("id", otpRecord.id);

    // Compare codes (stored as SHA-256 hash)
    if (hashOTP(otp) !== otpRecord.code) {
      const attemptsLeft = 4 - otpRecord.attempts; // already incremented
      return NextResponse.json(
        {
          error: `Invalid code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`,
        },
        { status: 400 }
      );
    }

    // Mark as verified
    await serviceClient
      .from("otp_verifications")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    // --- Step 2: Find or create Supabase user ---

    const syntheticEmail = phoneToSyntheticEmail(phone);
    let userId: string;
    let isNewUser = false;

    // Check if user exists in our users table by phone
    const { data: existingUser } = await serviceClient
      .from("users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // New user — create in Supabase Auth
      const { data: authData, error: authError } =
        await serviceClient.auth.admin.createUser({
          email: syntheticEmail,
          phone,
          password: crypto.randomUUID(), // random, never used for login
          email_confirm: true,
          phone_confirm: true,
        });

      if (authError || !authData.user) {
        logger.error("Failed to create auth user", {
          source: "auth/verify-otp",
          phone,
          errorMessage: authError?.message || "No user returned",
        });
        return NextResponse.json(
          { error: "Failed to create account. Please try again." },
          { status: 500 }
        );
      }

      userId = authData.user.id;
      isNewUser = true;

      // Create users table row
      const { error: insertError } = await serviceClient
        .from("users")
        .insert({
          id: userId,
          phone,
          locale: "en",
        });

      if (insertError) {
        logger.error("Failed to create user profile", {
          source: "auth/verify-otp",
          userId,
          errorMessage: insertError.message,
        });
        // Clean up auth user
        await serviceClient.auth.admin.deleteUser(userId);
        return NextResponse.json(
          { error: "Failed to create account. Please try again." },
          { status: 500 }
        );
      }

      // Unified referral routing. Three surfaces, resolved by the typed
      // dispatch in resolveAndApplyReferral:
      //   1. /b/[slug]/?agent=[code]  → branch_signup with sub-agent
      //   2. /b/[slug]                → branch_signup, attribute to manager
      //   3. /r/[code] or manual      → direct_code (legacy path)
      // /b/[slug] wins over /r/[code] when both are present (URL is stronger
      // signal than persisted ref).
      try {
        if (branchSlug) {
          await resolveAndApplyReferral(userId, {
            type: "branch_signup",
            branchSlug,
            agentCode: agentCode || undefined,
          });
        } else if (referralCode) {
          await resolveAndApplyReferral(userId, referralCode);
        }
      } catch (err) {
        // Don't let a referral bookkeeping failure block signup.
        logger.error("Unexpected error in referral capture", {
          source: "auth/verify-otp",
          userId,
          referralCode,
          branchSlug,
          agentCode,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- Step 3: Generate Supabase session ---

    // Generate magic link token for session creation
    const { data: linkData, error: linkError } =
      await serviceClient.auth.admin.generateLink({
        type: "magiclink",
        email: syntheticEmail,
      });

    if (linkError || !linkData.properties?.hashed_token) {
      logger.error("Failed to generate session link", {
        source: "auth/verify-otp",
        userId,
        errorMessage: linkError?.message || "No hashed_token",
      });
      return NextResponse.json(
        { error: "Failed to sign in. Please try again." },
        { status: 500 }
      );
    }

    // Exchange token for session using SSR client (sets cookies)
    const response = NextResponse.json({ success: true, isNewUser });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.headers
              .get("cookie")
              ?.split("; ")
              .map((c) => {
                const [name, ...rest] = c.split("=");
                return { name, value: rest.join("=") };
              }) ?? [];
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });

    if (verifyError) {
      logger.error("Failed to verify magic link token", {
        source: "auth/verify-otp",
        userId,
        errorMessage: verifyError.message,
      });
      return NextResponse.json(
        { error: "Failed to sign in. Please try again." },
        { status: 500 }
      );
    }

    return response;
  } catch (err) {
    logger.error("Verify OTP error", {
      source: "auth/verify-otp",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
