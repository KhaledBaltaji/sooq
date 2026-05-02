"use client";

import Link from "next/link";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { formatCurrency } from "@/lib/utils";
import { PieChart } from "lucide-react";

export function PortfolioSidebar() {
  const { user, loading } = useUser();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();

  if (loading) {
    return (
      <div className="bg-surface rounded-lg p-5 border border-border-custom/30 animate-pulse">
        <div className="h-4 bg-elevated rounded w-24 mb-6" />
        <div className="h-8 bg-elevated rounded w-32 mb-4" />
        <div className="h-10 bg-elevated rounded w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="bg-surface rounded-lg p-5 border border-border-custom/30">
        <h3 className="font-satoshi font-black text-xs uppercase tracking-widest text-muted-custom mb-4">
          Your Portfolio
        </h3>
        <p className="text-sm text-muted-custom mb-4">Sign in to track your positions and P&L.</p>
        <button
          onClick={openLoginModal}
          className="w-full py-2.5 bg-yes/10 text-yes rounded-md font-satoshi font-bold text-xs text-center hover:bg-yes/20 transition-colors"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg p-5 border border-border-custom/30">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-satoshi font-black text-xs uppercase tracking-widest text-muted-custom">
          Your Portfolio
        </h3>
        <PieChart className="w-4 h-4 text-yes" />
      </div>

      <div className="space-y-4">
        {/* Net worth */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-custom uppercase font-bold tracking-widest">
            PORTFOLIO BALANCE
          </span>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-satoshi font-black tracking-tighter text-text tabular-nums">
              {formatCurrency(user.balance_usd)}
            </span>
          </div>
        </div>

        {/* Agent Wallet (shown if > 0) */}
        {user.agent_balance_usd > 0 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-[10px] text-muted-custom uppercase font-bold tracking-widest">
              Agent Wallet
            </span>
            <span className="text-sm font-satoshi font-bold text-warning tabular-nums">
              {formatCurrency(user.agent_balance_usd)}
            </span>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4 border-t border-border-custom pt-4">
          <div className="flex flex-col">
            <span className="text-[9px] text-muted-custom uppercase font-bold">POSITIONS</span>
            <span className="text-sm font-satoshi font-bold text-text">—</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-muted-custom uppercase font-bold">PNL (TOTAL)</span>
            <span className="text-sm font-satoshi font-bold text-success">—</span>
          </div>
        </div>

        {/* CTA — 3D deposit button */}
        <button
          onClick={openDepositModal}
          className="block w-full py-3 mt-2 bg-yes text-white rounded-lg font-satoshi font-black text-xs uppercase tracking-widest text-center cursor-pointer transition-all duration-[80ms] hover:brightness-110 shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]"
        >
          Deposit to Trade
        </button>
      </div>
    </div>
  );
}
