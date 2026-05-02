import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { resolveAndApplyReferral } from "@/lib/auth/actions";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const ref = searchParams.get("ref");
  const branchSlug = searchParams.get("branch");
  const agentCode = searchParams.get("agent");
  const next = searchParams.get("next") ?? "/";

  // Build ResolverInput once — /b/[slug] wins over /r/[code] when both present
  const resolverInput = branchSlug
    ? ({ type: "branch_signup" as const, branchSlug, agentCode: agentCode || undefined })
    : ref
      ? ref
      : null;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Ensure user profile exists in our users table
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existingProfile } = await supabase
          .from("users")
          .select("id, referred_by, display_name, avatar_url, email")
          .eq("id", user.id)
          .single();

        // Sync Google profile data to users table
        const googleEmail = user.email || user.user_metadata?.email || null;
        const googleName = user.user_metadata?.full_name || user.user_metadata?.name || null;
        const googleAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

        if (!existingProfile) {
          // First time Google login — create profile row.
          // email and display_name are set via follow-up updates because they
          // carry UNIQUE indexes (users_email_key, idx_users_display_name_unique)
          // and would block signup when Google's full_name matches an existing
          // user. Unique collisions on optional fields must not fail the account.
          const { error: insertError } = await supabase.from("users").insert({
            id: user.id,
            avatar_url: googleAvatar,
            locale: "en",
          });
          if (insertError) {
            logger.error("Failed to create user profile", {
              source: "auth/callback",
              userId: user.id,
              errorMessage: insertError.message,
            });
            return NextResponse.redirect(`${origin}/login?error=profile_creation_failed`);
          }

          // Best-effort sync of email + display_name. Failures are non-fatal:
          // the user has an account; they can edit these in profile settings.
          if (googleEmail) {
            const { error: emailError } = await supabase
              .from("users")
              .update({ email: googleEmail })
              .eq("id", user.id);
            if (emailError) {
              logger.warn("OAuth email sync skipped — likely unique collision", {
                source: "auth/callback",
                userId: user.id,
                errorMessage: emailError.message,
              });
            }
          }
          if (googleName) {
            const { error: nameError } = await supabase
              .from("users")
              .update({ display_name: googleName })
              .eq("id", user.id);
            if (nameError) {
              logger.warn("OAuth display_name sync skipped — likely unique collision", {
                source: "auth/callback",
                userId: user.id,
                googleName,
                errorMessage: nameError.message,
              });
            }
          }

          // Handle referral for new OAuth users — unified lookup across
          // branch_agents + users.referral_code + commission-branch slug.
          if (resolverInput !== null) {
            const result = await resolveAndApplyReferral(user.id, resolverInput);
            if (!result.ok && result.error) {
              logger.warn("OAuth referral failed", {
                source: "auth/callback",
                userId: user.id,
                referralCode: ref,
                branchSlug,
                agentCode,
                kind: result.kind,
                errorMessage: result.error,
              });
            }
          }
        } else {
          // Existing user — sync email from Google if not already set
          const updates: { email?: string; display_name?: string; avatar_url?: string } = {};
          if (googleEmail) updates.email = googleEmail;
          if (googleName && !existingProfile.display_name) updates.display_name = googleName;
          if (googleAvatar && !existingProfile.avatar_url) updates.avatar_url = googleAvatar;

          if (Object.keys(updates).length > 0) {
            await supabase
              .from("users")
              .update(updates)
              .eq("id", user.id);
          }
        }

        if (resolverInput !== null && !existingProfile?.referred_by) {
          // Existing retail user without a referrer — link them via unified
          // lookup. For branch-slug signups, first-touch is enforced inside
          // resolveAndApplyReferral so a user who already has a referrer stays
          // with their original.
          const result = await resolveAndApplyReferral(user.id, resolverInput);
          if (!result.ok && result.error) {
            logger.warn("OAuth referral failed for existing user", {
              source: "auth/callback",
              userId: user.id,
              referralCode: ref,
              branchSlug,
              agentCode,
              kind: result.kind,
              errorMessage: result.error,
            });
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to login with error indicator
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
