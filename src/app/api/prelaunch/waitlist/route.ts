import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Offset so positions appear to start at ~371 (social proof)
const POSITION_OFFSET = 370;

async function sendNotificationEmail(email: string, position: number, referredBy?: string) {
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;
  if (!SLACK_WEBHOOK) return;

  try {
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:tada: *New shu-rayak signup!*\n\nEmail: \`${email}\`\nPosition: #${position}\n${referredBy ? `Referred by: \`${referredBy}\`` : "Organic signup"}`,
      }),
    });
  } catch {
    // Non-critical — don't fail the signup if notification fails
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, referralCode, votes } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email address required" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if email already exists
  const { data: existing } = await supabase
    .from("prelaunch_waitlist")
    .select("position, referral_code")
    .eq("email", normalizedEmail)
    .single();

  if (existing) {
    return NextResponse.json({
      position: existing.position + POSITION_OFFSET,
      referralCode: existing.referral_code,
      isNew: false,
    });
  }

  // Insert new waitlist entry
  const { data: inserted, error } = await supabase
    .from("prelaunch_waitlist")
    .insert({
      email: normalizedEmail,
      referred_by: referralCode || null,
      votes_json: votes || null,
    })
    .select("position, referral_code")
    .single();

  if (error) {
    // Handle race condition — email was inserted between check and insert
    if (error.code === "23505") {
      const { data: raceRow } = await supabase
        .from("prelaunch_waitlist")
        .select("position, referral_code")
        .eq("email", normalizedEmail)
        .single();

      if (raceRow) {
        return NextResponse.json({
          position: raceRow.position + POSITION_OFFSET,
          referralCode: raceRow.referral_code,
          isNew: false,
        });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Increment referrer's count if provided
  if (referralCode) {
    await supabase.rpc("increment_referral_count", {
      p_referral_code: referralCode,
    });
  }

  // Send notification (non-blocking)
  sendNotificationEmail(normalizedEmail, inserted.position + POSITION_OFFSET, referralCode);

  return NextResponse.json({
    position: inserted.position + POSITION_OFFSET,
    referralCode: inserted.referral_code,
    isNew: true,
  });
}
