"use client";

import { useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

export function CompleteProfileModal() {
  const supabase = useSupabase();
  const { user, authUser, refetch } = useUser();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Only show if: user is authenticated, has a profile row, but no display_name
  const shouldShow = authUser && user && !user.display_name;
  // Phone users have synthetic emails (@phone.sooq.exchange) — don't prompt for email
  const isSyntheticEmail = authUser?.email?.endsWith("@phone.sooq.exchange");
  const needsEmail = authUser && !authUser.email && !isSyntheticEmail;

  if (!shouldShow) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !authUser) return;

    setLoading(true);
    setError(null);

    // Check uniqueness first
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .ilike("display_name", name.trim())
      .neq("id", authUser.id)
      .limit(1);

    if (existing && existing.length > 0) {
      setError(t("usernameTaken"));
      setLoading(false);
      return;
    }

    // Update display name
    const { error: updateError } = await supabase
      .from("users")
      .update({ display_name: name.trim() })
      .eq("id", authUser.id);

    if (updateError) {
      if (updateError.message.includes("unique") || updateError.message.includes("duplicate")) {
        setError(t("usernameTaken"));
      } else {
        setError(t("failedToSaveProfile"));
      }
      setLoading(false);
      return;
    }

    // Link email if provided (phone signup users)
    if (needsEmail && email.trim()) {
      const { error: authEmailError } = await supabase.auth.updateUser({ email: email.trim() });
      if (authEmailError) {
        setError(authEmailError.message);
        setLoading(false);
        return;
      }
      const { error: syncError } = await supabase
        .from("users")
        .update({ email: email.trim() })
        .eq("id", authUser.id);
      if (syncError) {
        console.error("Failed to sync email to users table:", syncError.message);
      }
    }

    setSaved(true);
    setLoading(false);
    // Show "Saved ✓" briefly, then force-close by refetching profile
    setTimeout(() => refetch(), 500);
  };

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop — no click to close */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-[400px] bg-surface rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.25)] animate-in fade-in zoom-in-95 duration-200">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <span className="font-satoshi font-black text-yes text-xl tracking-tighter">sooq</span>
          </div>

          {/* Content */}
          <div className="text-center mb-6">
            <h2 className="text-lg font-medium text-text font-satoshi mb-2">
              {t("completeYourProfile")}
            </h2>
            <p className="text-base text-muted-custom">
              {t("chooseUsernameDesc")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-dm-sans font-medium text-muted-custom uppercase tracking-wider">
                {t("usernameLabel")}
              </label>
              <input
                type="text"
                placeholder={t("usernamePlaceholder")}
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                autoFocus
                maxLength={30}
                className={cn(
                  "w-full h-12 bg-bg border rounded-md px-4 text-text",
                  "placeholder:text-dim font-dm-sans text-sm",
                  "focus:outline-none focus:ring-1 transition-all",
                  error
                    ? "border-no focus:border-no focus:ring-no/30"
                    : "border-border-custom focus:border-yes focus:ring-yes/30"
                )}
              />
              <div className="flex justify-between">
                {error ? (
                  <p className="text-xs text-no">{error}</p>
                ) : (
                  <span />
                )}
                <p className="text-xs text-dim">{name.length}/30</p>
              </div>
            </div>

            {needsEmail && (
              <div className="space-y-1.5">
                <label className="block text-xs font-dm-sans font-medium text-muted-custom uppercase tracking-wider">
                  {t("emailAddress")}
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn(
                    "w-full h-12 bg-bg border border-border-custom rounded-md px-4 text-text",
                    "placeholder:text-dim font-dm-sans text-sm",
                    "focus:outline-none focus:border-yes focus:ring-1 focus:ring-yes/30 transition-all"
                  )}
                />
                <p className="text-xs text-dim">{t("emailRecoveryHint")}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || loading || saved}
              className={cn(
                "w-full h-12 font-bold text-sm rounded-md",
                "transition-all active:scale-[0.97]",
                "disabled:cursor-not-allowed",
                saved
                  ? "bg-success text-white"
                  : "bg-yes text-white hover:shadow-[0_0_20px_rgba(45,140,255,0.25)] disabled:opacity-50"
              )}
            >
              {saved ? (
                <span className="flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" /> {t("saved")}
                </span>
              ) : loading ? (
                tc("saving")
              ) : (
                tc("continue")
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
