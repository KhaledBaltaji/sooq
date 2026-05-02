"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { springs } from "@/lib/motion";

interface WaitlistViewProps {
  referralCode?: string | null;
  votes: Record<string, "yes" | "no">;
  onComplete: (data: { position: number; referralCode: string }) => void;
}

export function WaitlistView({
  referralCode,
  votes,
  onComplete,
}: WaitlistViewProps) {
  const t = useTranslations("prelaunch");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSubmit = async () => {
    setError("");

    if (!email || !isValidEmail(email)) {
      setError(t("invalidEmail"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/prelaunch/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          referralCode: referralCode || undefined,
          votes: Object.keys(votes).length > 0 ? votes : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("invalidEmail"));
        setLoading(false);
        return;
      }

      onComplete({
        position: data.position,
        referralCode: data.referralCode,
      });
    } catch (err) {
      console.error("Waitlist submission failed:", err);
      setError(t("serverError") ?? "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <motion.div
        className="w-full max-w-sm flex flex-col items-center gap-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.smooth}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-satoshi font-black text-text">
            {t("waitlistTitle")}
          </h2>
          <p className="text-sm text-muted-custom">{t("waitlistSubtitle")}</p>
        </div>

        {/* Email input */}
        <div className="w-full space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={t("emailPlaceholder")}
            className="w-full h-14 rounded-lg bg-surface border border-border-custom px-4 text-text placeholder:text-dim font-satoshi text-base focus:outline-none focus:ring-2 focus:ring-yes/50 focus:border-yes transition-colors"
          />

          {error && (
            <p className="text-sm text-no text-center">{error}</p>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full h-14 rounded-lg bg-yes text-white font-satoshi font-bold text-lg shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] hover:brightness-110 transition-all duration-[80ms] disabled:opacity-50 disabled:!translate-y-0"
        >
          {loading ? t("signingUp") : t("signUp")}
        </button>
      </motion.div>
    </div>
  );
}
