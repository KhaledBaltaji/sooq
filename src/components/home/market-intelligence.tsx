"use client";

import type { MarketWithAmm } from "@/types/market";
import { useLocale } from "next-intl";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useUser } from "@/lib/auth/hooks";
import { formatCurrency } from "@/lib/utils";

interface MarketIntelligenceProps {
  market: MarketWithAmm;
}

export function MarketIntelligence({ market }: MarketIntelligenceProps) {
  const locale = useLocale();
  const { openDepositModal } = useDepositModal();
  const { openLoginModal } = useAuthModal();
  const { user: profile } = useUser();

  const description = locale === "ar" ? market.description_ar : market.description_en;
  const resolutionDate = new Date(market.closes_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <aside className="hidden xl:flex flex-col gap-6 sticky top-20 self-start">
      {/* Balance + Deposit Card */}
      <div className="bg-surface rounded-2xl border border-border-custom shadow-2xl p-6">
        {profile && (
          <div className="mb-4">
            <p className="text-[10px] text-muted-custom uppercase font-bold tracking-widest mb-1">Portfolio Balance</p>
            <p className="text-2xl font-black font-satoshi text-text tabular-nums">{formatCurrency(profile.balance_usd ?? 0)}</p>
          </div>
        )}
        <button
          onClick={() => (profile ? openDepositModal() : openLoginModal())}
          className="w-full bg-yes text-white py-3 rounded-lg text-sm font-black font-satoshi hover:bg-yes/90 transition-all shadow-lg shadow-yes/10 cursor-pointer"
        >
          Deposit Funds
        </button>
      </div>

      {/* Market Intelligence Card */}
      <div className="bg-surface rounded-2xl border border-border-custom shadow-2xl p-6">
        <h3 className="font-satoshi text-xs font-black text-muted-custom uppercase tracking-widest mb-4">
          Market Intelligence
        </h3>
        <div className="space-y-6">
          {/* Why this market matters */}
          <div>
            <h4 className="text-xs font-bold text-text mb-1">Why this market matters</h4>
            <p className="text-[13px] text-muted-custom leading-relaxed">
              {description || "This market tracks a key regional event with significant economic and political implications."}
            </p>
          </div>

          {/* Latest Update */}
          <div>
            <h4 className="text-xs font-bold text-text mb-1">Latest Update</h4>
            <div className="bg-bg border border-border-custom p-3 rounded-lg">
              <p className="text-[11px] text-yes font-bold mb-1">2 hours ago</p>
              <p className="text-[12px] text-text">Market activity increasing as resolution date approaches. Key stakeholders expected to make announcements.</p>
            </div>
          </div>

          {/* Resolution Date + Status */}
          <div className="flex justify-between items-center py-3 border-y border-border-custom">
            <div>
              <h4 className="text-xs font-bold text-text">Resolution Date</h4>
              <p className="text-[11px] text-muted-custom">{resolutionDate}</p>
            </div>
            <div className="text-right">
              <h4 className="text-xs font-bold text-text">Status</h4>
              <div className="flex items-center gap-1.5 justify-end">
                <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-[11px] text-muted-custom">Live</span>
              </div>
            </div>
          </div>

          {/* How it resolves */}
          <div>
            <h4 className="text-xs font-bold text-text mb-1">How it resolves</h4>
            <p className="text-[12px] text-muted-custom leading-relaxed mb-4">
              Resolves based on official announcements or verified reporting from institutional sources by the resolution date at 11:59 PM UTC.
            </p>
            <div className="bg-bg/50 border-l-2 border-yes p-3 rounded-r-lg">
              <h4 className="text-[10px] font-bold text-yes uppercase tracking-wider mb-1">Resolution Source</h4>
              <p className="text-[11px] text-text leading-tight">Official government sources, verified wire services (Reuters, AFP), or institutional data providers.</p>
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-[10px] text-dim">Regulated by the Predictive Markets Authority</p>
    </aside>
  );
}
