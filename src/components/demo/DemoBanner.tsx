"use client";

import { useTranslations } from "next-intl";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sticky banner at the top of every /demo/* page. "You're in Demo Mode" with a
 * persistent, passive "Ready to trade for real? Deposit now" CTA that opens the
 * existing deposit modal.
 */
export function DemoBanner({ className }: { className?: string }) {
  const t = useTranslations("demo");
  const { openDepositModal } = useDepositModal();

  return (
    <div
      className={cn(
        "w-full bg-amber-500/10 border-b border-amber-500/30",
        className
      )}
      role="status"
    >
      <div className="max-w-[1240px] mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-satoshi font-bold text-amber-700 dark:text-amber-300 truncate">
              {t("banner.title")}
            </span>
            <span className="text-[11px] text-muted-custom truncate">
              {t("banner.subtitle")}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={openDepositModal}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-yes px-3 py-1.5 text-xs font-satoshi font-bold text-white hover:bg-yes/90 transition-colors"
        >
          <span className="hidden sm:inline">{t("ctaReal")}</span>
          <span>{t("ctaDeposit")}</span>
        </button>
      </div>
    </div>
  );
}
