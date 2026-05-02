"use client";

import { useState } from "react";
import Image from "next/image";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { formatSharePrice } from "@/lib/market-utils";
import {
  CheckCircle2, XCircle, Clock,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { BranchMarketData } from "./branch-markets-client";

const CATEGORY_GRADIENTS: Record<string, string> = {
  politics: "from-[#2D8CFF]/20 to-[#f7f9fb]",
  economy: "from-[#22C55E]/20 to-[#f7f9fb]",
  economics: "from-[#22C55E]/20 to-[#f7f9fb]",
  sports: "from-[#F59E0B]/20 to-[#f7f9fb]",
  tech: "from-[#A855F7]/20 to-[#f7f9fb]",
  finance: "from-[#22C55E]/20 to-[#f7f9fb]",
  entertainment: "from-[#EC4899]/20 to-[#f7f9fb]",
  general: "from-[#a9b4b9]/20 to-[#f7f9fb]",
};

/** Inline probability gauge — no i18n dependency */
function ProbabilityGauge({ percent }: { percent: number }) {
  const size = 72;
  const sw = 7;
  const r = (size - sw) / 2;
  const half = Math.PI * r;
  const fill = (percent / 100) * half;
  return (
    <div className="flex flex-col items-center flex-shrink-0" style={{ width: size }}>
      <svg
        width={size}
        height={size / 2 + sw / 2}
        viewBox={`0 0 ${size} ${size / 2 + sw / 2}`}
        className="overflow-visible"
      >
        <path
          d={`M ${sw / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - sw / 2} ${size / 2}`}
          fill="none" stroke="#d9e4ea" strokeWidth={sw} strokeLinecap="round"
        />
        <path
          d={`M ${sw / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - sw / 2} ${size / 2}`}
          fill="none" stroke="var(--yes)" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${fill} ${half - fill}`}
        />
      </svg>
      <span className="text-[#2a3439] font-black text-sm font-[family-name:var(--font-satoshi)] -mt-3 tabular-nums">
        {percent.toFixed(1)}%
      </span>
      <span className="text-[var(--yes)] text-[9px] font-bold leading-none">yes chance</span>
    </div>
  );
}

interface BranchMarketCardProps {
  data: BranchMarketData;
  branchId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (marketId: string, newValue: boolean) => void;
  toggling: boolean;
}

export function BranchMarketCard({
  data, branchId, isExpanded, onToggleExpand, onToggleEnabled, toggling,
}: BranchMarketCardProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const { market, isEnabled, cashOutEnabled, positionCapYes, positionCapNo, revenue, exposure } = data;

  const yesPrice = market.amm_state?.current_yes_price ?? 0.5;
  const noPrice = market.amm_state?.current_no_price ?? 0.5;
  const yesPct = parseFloat((yesPrice * 100).toFixed(1));
  const isOpen = market.status === "open";
  const catKey = (market.category || "general").toLowerCase();
  const gradientClass = CATEGORY_GRADIENTS[catKey] || CATEGORY_GRADIENTS.general;

  // Local state for position caps
  const [capYes, setCapYes] = useState<string>(positionCapYes?.toString() ?? "");
  const [capNo, setCapNo] = useState<string>(positionCapNo?.toString() ?? "");
  const [localCashOut, setLocalCashOut] = useState<string>(
    cashOutEnabled === null ? "" : cashOutEnabled ? "true" : "false"
  );
  const [savingCaps, setSavingCaps] = useState(false);

  const handleSaveCaps = async () => {
    setSavingCaps(true);
    const { error } = await supabase.from("branch_market_config").upsert(
      {
        branch_id: branchId,
        market_id: market.id,
        is_enabled: isEnabled,
        cash_out_enabled: localCashOut === "" ? null : localCashOut === "true",
        position_cap_yes: capYes ? parseFloat(capYes) : null,
        position_cap_no: capNo ? parseFloat(capNo) : null,
      },
      { onConflict: "branch_id,market_id" }
    );
    setSavingCaps(false);
    if (error) {
      toast.error("Failed to save", { description: error.message });
    } else {
      toast.success("Settings saved");
    }
  };

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-shadow hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
      {/* Clickable card body */}
      <div onClick={onToggleExpand} className="cursor-pointer">
        {/* Hero image */}
        <div className="relative h-44 overflow-hidden">
          {market.image_url ? (
            <Image
              src={market.image_url}
              alt=""
              fill
              className="object-cover opacity-60"
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${gradientClass}`} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent" />

          {/* Enabled/disabled badge */}
          <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold backdrop-blur-sm ${
            isEnabled ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-600"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? "bg-emerald-500" : "bg-red-500"}`} />
            {isEnabled ? "On" : "Off"}
          </div>

          {/* Question + gauge */}
          <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
            <h3 className="flex-1 text-lg font-semibold font-[family-name:var(--font-satoshi)] leading-snug text-[#2a3439]">
              {market.question_en}
            </h3>
            {isOpen && <ProbabilityGauge percent={yesPct} />}
          </div>
        </div>

        {/* YES/NO prices or status */}
        {isOpen ? (
          <div className="grid grid-cols-2 gap-2 px-4 pt-2 pb-3">
            <div className="flex items-center justify-center py-2.5 rounded-lg bg-[var(--yes)] text-white text-sm font-[family-name:var(--font-satoshi)] font-black">
              Yes {formatSharePrice(yesPrice)}
            </div>
            <div className="flex items-center justify-center py-2.5 rounded-lg bg-[var(--no)] text-white text-sm font-[family-name:var(--font-satoshi)] font-black">
              No {formatSharePrice(noPrice)}
            </div>
          </div>
        ) : (
          <div className="px-4 pt-2 pb-3">
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#f0f4f7] text-[#566166] font-[family-name:var(--font-satoshi)] font-bold text-sm">
              {market.status === "resolved" ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Resolved {market.outcome === "yes" ? "Yes" : "No"}
                </>
              ) : market.status === "voided" ? (
                <>
                  <XCircle className="w-4 h-4 text-red-500" />
                  Voided
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  Closed
                </>
              )}
            </div>
          </div>
        )}


        {/* Footer — expand chevron only (volume + trader count removed from user view) */}
        <div className="border-t border-[#a9b4b9]/10 px-4 py-2.5 flex items-center justify-end">
          <ChevronDown className={`w-4 h-4 text-[#a9b4b9] transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      {/* Expandable detail panel */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="border-t-2 border-[#d9e4ea] bg-[#f7f9fb] px-5 py-5 space-y-5">

            {/* Toggle enable/disable */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#2a3439]">Enable for branch</p>
                <p className="text-xs text-[#566166]">Disabled markets won&apos;t accept trades</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleEnabled(market.id, !isEnabled); }}
                disabled={toggling}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                  isEnabled ? "bg-[var(--yes)]" : "bg-[#d9e4ea]"
                } ${toggling ? "opacity-50" : ""}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                  isEnabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Revenue breakdown */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">Revenue</p>
              {revenue ? (
                <div className="space-y-1.5">
                  {([
                    ["Markup", revenue.markup],
                    ["Trading Fees", revenue.explicitFee],
                    ["Exit Fees", revenue.exitFee],
                    ["Resolution Fees", revenue.resolutionFee],
                  ] as const).map(([label, val]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-[#566166]">{label}</span>
                      <span className="font-mono font-medium text-[#2a3439]">{formatCurrency(val)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs">
                    <span className="text-[#566166]">SOOQ Fee</span>
                    <span className="font-mono font-medium text-red-500">-{formatCurrency(revenue.sooqFee)}</span>
                  </div>
                  <div className="border-t border-[#d9e4ea] pt-1.5 flex justify-between text-xs">
                    <span className="font-semibold text-[#2a3439]">Net Revenue</span>
                    <span className="font-mono font-bold text-emerald-600">{formatCurrency(revenue.total - revenue.sooqFee)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#a9b4b9]">Revenue appears after market resolves</p>
              )}
            </div>

            {/* Risk / exposure */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">Exposure</p>
              {isOpen && (exposure.yesShares > 0 || exposure.noShares > 0) ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#566166]">YES shares held</span>
                    <span className="font-mono font-medium text-[#2a3439]">{exposure.yesShares.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#566166]">NO shares held</span>
                    <span className="font-mono font-medium text-[#2a3439]">{exposure.noShares.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-[#d9e4ea] pt-1.5 flex justify-between text-xs">
                    <span className="font-semibold text-[#2a3439]">Worst-case liability</span>
                    <span className="font-mono font-bold text-amber-600">
                      {formatCurrency(Math.max(exposure.yesShares, exposure.noShares) * 0.99)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#a9b4b9]">
                  {market.status === "resolved" ? "Positions settled" : "No active exposure"}
                </p>
              )}
            </div>

            {/* Position limits */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">Position Limits</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#566166] mb-1 block">Cap YES ($)</label>
                    <input
                      type="number"
                      placeholder="Inherit"
                      value={capYes}
                      onChange={(e) => setCapYes(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full px-3 py-2 bg-white border border-[#d9e4ea] rounded-lg text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#566166] mb-1 block">Cap NO ($)</label>
                    <input
                      type="number"
                      placeholder="Inherit"
                      value={capNo}
                      onChange={(e) => setCapNo(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full px-3 py-2 bg-white border border-[#d9e4ea] rounded-lg text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#566166]">Cash-out override</span>
                  <select
                    value={localCashOut}
                    onChange={(e) => { e.stopPropagation(); setLocalCashOut(e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className="px-3 py-1.5 bg-white border border-[#d9e4ea] rounded-lg text-xs focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                  >
                    <option value="">Inherit branch default</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); handleSaveCaps(); }}
                  disabled={savingCaps}
                  className="w-full py-2 bg-[#2a3439] text-white text-sm font-bold rounded-lg hover:bg-[#1a2429] transition-colors disabled:opacity-50"
                >
                  {savingCaps ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
