"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { useDemoResetBalance } from "@/hooks/demo/use-demo-reset-balance";
import { cn } from "@/lib/utils";

/**
 * "Reset demo balance" button with confirmation modal. Calls demo_reset_balance
 * which sets balance to $10,000 but preserves open positions (documented
 * free-option exploit accepted by product).
 */
export function DemoResetButton({ className }: { className?: string }) {
  const t = useTranslations("demo");
  const [confirming, setConfirming] = useState(false);
  const { reset, loading, error } = useDemoResetBalance();

  const handleConfirm = async () => {
    const res = await reset();
    if (res.data) {
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-satoshi font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors",
          className
        )}
      >
        <RotateCcw className="w-4 h-4" />
        {t("settings.resetSection")}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-satoshi font-bold text-text">
            {t("resetConfirm.title")}
          </h4>
          <p className="text-xs text-muted-custom mt-1">
            {t("resetConfirm.body")}
          </p>
        </div>
      </div>
      {error && <p className="text-xs text-no">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="flex-1 rounded-lg border border-border-custom bg-surface px-4 py-2 text-sm font-satoshi font-bold text-text hover:bg-elevated transition-colors"
        >
          {t("resetConfirm.cancel")}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-satoshi font-bold text-white hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "..." : t("resetConfirm.confirm")}
        </button>
      </div>
    </div>
  );
}
