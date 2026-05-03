"use client";

// W7 cutover: standalone withdraw page now uses /api/fees + /api/withdrawal/process.
// Kept simple — only USDT TRC20 supported here. The richer destination
// flow (with whish phone option) lives in WithdrawModal.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useBalance } from "@/hooks/use-balance";
import { useFeeRates } from "@/hooks/use-fee-rates";
import { useSession } from "@/lib/auth/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_WITHDRAWAL } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { SignInPrompt } from "@/components/auth/sign-in-prompt";

export default function WithdrawPage() {
  const router = useRouter();
  const t = useTranslations("wallet");
  const { user, loading: authLoading } = useSession();
  const { balance } = useBalance();
  const feeRate = useFeeRates().withdrawal;
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);

  if (!authLoading && !user) {
    return (
      <SignInPrompt
        icon={ArrowDownToLine}
        title="Sign in to withdraw funds"
        description="Create an account or sign in to access your balance and withdraw to your wallet."
      />
    );
  }

  const numAmount = parseFloat(amount) || 0;
  const fee = numAmount * feeRate;
  const netAmount = numAmount - fee;

  const handleWithdraw = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/withdrawal/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numAmount,
          method: "crypto",
          account_details: { network: "TRC20", address: destination.trim() },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || "Withdrawal failed");
      } else {
        toast.success("Withdrawal submitted");
        router.push("/transactions");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-md py-lg space-y-lg max-w-lg mx-auto">
      <div className="flex items-center gap-sm">
        <button onClick={() => router.back()} className="text-muted hover:text-text">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-satoshi text-lg font-bold text-text">
          {t("withdrawFunds")}
        </h1>
      </div>

      <p className="text-muted text-sm">
        Available: <span className="text-text font-medium">{formatCurrency(balance)}</span>
      </p>

      <div className="space-y-sm">
        <Input
          type="number"
          placeholder="Amount (USD)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min={MIN_WITHDRAWAL}
          max={balance}
          className="bg-elevated border-elevated"
        />

        <Input
          type="text"
          placeholder="USDT (TRC-20) wallet address"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="bg-elevated border-elevated font-mono text-sm"
        />
      </div>

      {numAmount >= MIN_WITHDRAWAL && (
        <div className="bg-surface rounded-lg p-sm space-y-xs text-sm font-dm-sans">
          <div className="flex justify-between">
            <span className="text-muted">Amount</span>
            <span className="text-text">{formatCurrency(numAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Fee ({(feeRate * 100).toFixed(0)}%)</span>
            <span className="text-text">-{formatCurrency(fee)}</span>
          </div>
          <div className="border-t border-elevated pt-xs flex justify-between font-medium">
            <span className="text-text">You receive</span>
            <span className="text-text">{formatCurrency(netAmount)}</span>
          </div>
        </div>
      )}

      <Button
        onClick={handleWithdraw}
        disabled={numAmount < MIN_WITHDRAWAL || !destination || loading || numAmount > balance}
        className="w-full h-12 bg-error hover:bg-error/90 text-white font-dm-sans font-semibold"
      >
        {loading ? "Processing..." : `Withdraw ${numAmount > 0 ? formatCurrency(netAmount) : ""}`}
      </Button>
    </div>
  );
}
