"use client";

import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";

export function BalanceChip() {
  const { user, loading } = useUser();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const isDemo = useDemoMode();
  const t = useTranslations("balanceChip");
  const tDemo = useTranslations("demo");

  if (loading) {
    return (
      <div className="hidden sm:flex h-8 w-20 bg-surface rounded-full animate-pulse border border-border-custom" />
    );
  }

  if (!user) {
    return (
      <button
        onClick={openLoginModal}
        className="h-11 md:h-8 px-4 flex items-center rounded-md bg-yes text-white text-sm font-satoshi font-bold cursor-pointer hover:brightness-110 transition-all"
      >
        {t("signIn")}
      </button>
    );
  }

  // In /demo/* routes, show the demo balance with a DEMO badge and hide the
  // Deposit button (demo has no deposits — the banner has a "Trade for real"
  // CTA if the user wants to switch back).
  if (isDemo) {
    const demoBalance = (user as unknown as { demo_balance_usd?: number | null }).demo_balance_usd ?? 0;
    return (
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col items-end leading-tight me-0.5">
          <span className="text-[10px] font-satoshi font-medium text-muted-custom leading-none">
            {tDemo("badge")}
          </span>
          <span className="text-sm font-satoshi font-bold text-warning tabular-nums leading-none mt-0.5">
            {formatCurrency(Number(demoBalance))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Cash + balance — stacked, no pill/border */}
      <div className="flex flex-col items-end leading-tight me-0.5">
        <span className="text-[10px] font-satoshi font-medium text-muted-custom leading-none">
          {t("cash")}
        </span>
        <span className="text-sm font-satoshi font-bold text-success tabular-nums leading-none mt-0.5">
          {formatCurrency(user.balance_usd)}
        </span>
      </div>

      {/* Deposit button — matches Polymarket: compact, rounded-lg */}
      <button
        onClick={openDepositModal}
        className="h-11 md:h-8 px-4 flex items-center rounded-lg bg-yes text-white text-[13px] font-satoshi font-bold cursor-pointer hover:bg-yes/90 transition-colors"
      >
        {t("deposit")}
      </button>
    </div>
  );
}
