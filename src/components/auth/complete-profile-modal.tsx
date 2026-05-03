"use client";

// W7 cutover: PATCH /api/users/profile replaces direct supabase.from('users').
// Email-update step removed — email is optional in v1 (Google login provides
// it; phone-only users can stay without). Display name has no uniqueness
// requirement in the slim schema.

import { useState } from "react";
import { useUser } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

export function CompleteProfileModal() {
  const { user, authUser, refetch } = useUser();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Only show if: user is authenticated, has a profile row, but no display_name
  const shouldShow = authUser && user && !user.display_name;
  if (!shouldShow) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !authUser) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t("failedToSaveProfile"));
        setLoading(false);
        return;
      }

      setSaved(true);
      setLoading(false);
      // Show "Saved ✓" briefly, then close by refetching profile.
      setTimeout(() => refetch(), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveProfile"));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-[400px] bg-surface rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.25)] animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-center mb-6">
            <span className="font-satoshi font-black text-yes text-xl tracking-tighter">sooq</span>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-lg font-medium text-text font-satoshi mb-2">
              {t("completeYourProfile")}
            </h2>
            <p className="text-base text-muted-custom">
              {t("chooseUsernameDesc")}
            </p>
          </div>

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
