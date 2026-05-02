"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useUser } from "@/lib/auth/hooks";
import { DEPOSIT_BONUS_AMOUNT, DEPOSIT_BONUS_MIN_DEPOSIT } from "@/lib/constants";
import { ArrowLeft, Wallet } from "lucide-react";
import { WhishManualForm } from "@/components/wallet/whish-manual-form";
import { SignInPrompt } from "@/components/auth/sign-in-prompt";

// USDT TRC20 + ERC20 ("3pay") deposit path is hidden from the UI until the
// 3pay merchant integration is live. The crypto network selector + wallet
// QR code + realtime confirmation listener were all removed. Whish Manual
// is the only deposit path users can use today.
export default function DepositPage() {
  const router = useRouter();
  const t = useTranslations("wallet");
  const { user, loading: userLoading } = useUser();

  // Deposit bonus eligibility: first deposit $20+, non-referred, not yet claimed
  const bonusEligible = user && !user.referred_by && !user.deposit_bonus_claimed;

  const handleWhishSuccess = () => {
    // Whish manual deposit submitted — redirect to transactions
    router.push("/transactions");
  };

  // Anonymous — show sign-in prompt instead of the deposit form
  if (!userLoading && !user) {
    return (
      <SignInPrompt
        icon={Wallet}
        title="Sign in to fund your account"
        description="Create an account or sign in to deposit funds and start trading markets."
      />
    );
  }

  return (
    <div className="px-md py-lg space-y-lg max-w-lg mx-auto">
      <div className="flex items-center gap-sm">
        <button onClick={() => router.back()} className="text-muted hover:text-text">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-satoshi text-lg font-bold text-text">
          {t("depositFunds")}
        </h1>
      </div>

      {/* Deposit bonus banner */}
      {bonusEligible && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-sm text-center">
          <p className="text-success text-sm font-dm-sans font-medium">
            Get ${DEPOSIT_BONUS_AMOUNT} free on your first ${DEPOSIT_BONUS_MIN_DEPOSIT}+ deposit!
          </p>
        </div>
      )}

      {/* Whish Manual: only deposit path available today */}
      <WhishManualForm onSuccess={handleWhishSuccess} />
    </div>
  );
}
