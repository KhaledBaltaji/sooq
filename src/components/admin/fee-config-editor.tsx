"use client";

import { useState } from "react";
import { EditFeeDialog } from "@/components/admin/edit-fee-dialog";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface FeeRow {
  id: string;
  fee_type: string;
  level: number | null;
  depth: number | null;
  rate: number;
  description: string | null;
}

interface FeeConfigEditorProps {
  fees: FeeRow[];
}

// ── Human-readable labels ──────────────────────────────────────

const FEE_LABELS: Record<string, { label: string; hint: string }> = {
  explicit_fee:              { label: "Trading Fee",            hint: "Applied on every buy and sell" },
  cash_out_premium:          { label: "Sell / Cash-Out Fee",    hint: "Extra cost when selling shares" },
  resolution_fee:            { label: "Winning Payout Fee",     hint: "Deducted from winning payouts" },
  deposit_fee:               { label: "Deposit Fee",            hint: "On incoming deposits" },
  withdrawal_fee:            { label: "Withdrawal Fee",         hint: "On outgoing withdrawals" },
  amm_default_b:             { label: "Liquidity Parameter (b)", hint: "Controls price sensitivity for new markets" },
  max_trade_pct:             { label: "Max Trade Size",         hint: "Maximum trade as % of liquidity" },
  dynamic_spread_threshold:  { label: "Spread Widening Trigger", hint: "Price level where spread widens" },
  dynamic_spread_multiplier: { label: "Spread Multiplier",      hint: "How aggressively spread widens" },
  min_trade_amount:          { label: "Minimum Trade",          hint: "Smallest allowed buy amount" },
};

const RAW_VALUE_FEES = new Set(["amm_default_b", "dynamic_spread_multiplier", "min_trade_amount"]);

function formatRate(fee: FeeRow): string {
  if (fee.fee_type === "dynamic_spread_multiplier") return `${Number(fee.rate)}x`;
  if (fee.fee_type === "amm_default_b" || fee.fee_type === "min_trade_amount")
    return `${Number(fee.rate)}`;
  return `${(fee.rate * 100).toFixed(2)}%`;
}

function getLabelForFee(fee: FeeRow): string {
  return FEE_LABELS[fee.fee_type]?.label || fee.fee_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getHintForFee(fee: FeeRow): string {
  return FEE_LABELS[fee.fee_type]?.hint || fee.description || "";
}

// ── Group definitions ──────────────────────────────────────────

const TIER_NAMES: Record<number, string> = {
  1: "Starter",
  2: "Active",
  3: "Power",
  4: "Elite",
};

const TIER_VOLUME: Record<number, string> = {
  1: "< $10K",
  2: "$10K+",
  3: "$50K+",
  4: "$200K+",
};

interface FeeGroup {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  types: string[];
  isCommission?: boolean;
}

const FEE_GROUPS: FeeGroup[] = [
  {
    key: "trading",
    title: "Trading Fees",
    subtitle: "Fees on buying, selling, and winning payouts",
    icon: "swap_horiz",
    types: ["explicit_fee", "cash_out_premium", "resolution_fee"],
  },
  {
    key: "money",
    title: "Deposits & Withdrawals",
    subtitle: "Fees on money in and out",
    icon: "account_balance",
    types: ["deposit_fee", "withdrawal_fee"],
  },
  {
    key: "amm",
    title: "AMM Settings",
    subtitle: "Market maker parameters that control pricing behavior",
    icon: "tune",
    types: ["amm_default_b", "max_trade_pct", "dynamic_spread_threshold", "dynamic_spread_multiplier", "min_trade_amount"],
  },
  {
    key: "commissions",
    title: "Agent Commissions",
    subtitle: "Revenue share by agent tier and referral layer",
    icon: "group",
    types: [],
    isCommission: true,
  },
];

// ── Components ─────────────────────────────────────────────────

function FeeItem({ fee, onClick }: { fee: FeeRow; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between px-5 py-4 hover:bg-[#f0f4f7]/50 active:bg-[#e8eff3] cursor-pointer transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#2a3439]">{getLabelForFee(fee)}</p>
        <p className="text-xs text-[#566166] mt-0.5">{getHintForFee(fee)}</p>
      </div>
      <div className="flex items-center gap-3 ml-4">
        <span className="text-base font-bold font-[family-name:var(--font-manrope)] text-[var(--yes)] tabular-nums">
          {formatRate(fee)}
        </span>
        <span className="material-symbols-outlined text-sm text-[#a9b4b9] group-hover:text-[#566166] transition-colors">
          chevron_right
        </span>
      </div>
    </div>
  );
}

function CollapsibleSection({
  group,
  fees,
  defaultOpen,
  onEditFee,
  commissionFees,
}: {
  group: FeeGroup;
  fees: FeeRow[];
  defaultOpen: boolean;
  onEditFee: (fee: FeeRow) => void;
  commissionFees?: FeeRow[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const count = group.isCommission ? (commissionFees?.length || 0) : fees.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between px-6 py-5 hover:bg-[#f0f4f7]/30 transition-colors cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#f0f4f7] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#566166] text-lg">{group.icon}</span>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-[#2a3439]">{group.title}</p>
              <p className="text-xs text-[#566166]">{group.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#a9b4b9] bg-[#f0f4f7] px-2.5 py-1 rounded-full">
              {count} {count === 1 ? "item" : "items"}
            </span>
            <span
              className="material-symbols-outlined text-[#a9b4b9] text-lg transition-transform duration-200"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              expand_more
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {group.isCommission ? (
            <CommissionTable fees={commissionFees || []} onEditFee={onEditFee} />
          ) : (
            <div className="border-t border-[#a9b4b9]/10 divide-y divide-[#a9b4b9]/10">
              {fees.map((fee) => (
                <FeeItem key={fee.id} fee={fee} onClick={() => onEditFee(fee)} />
              ))}
              {fees.length === 0 && (
                <div className="px-6 py-8 text-center">
                  <p className="text-sm text-[#566166]">No fees configured</p>
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function CommissionTable({ fees, onEditFee }: { fees: FeeRow[]; onEditFee: (fee: FeeRow) => void }) {
  // Group by commission type (trade vs resolution), then by level
  const tradeFees = fees.filter(f => f.fee_type === "ngr_commission");
  const resolutionFees = fees.filter(f => f.fee_type === "ngr_resolution_commission");

  // Group trade fees by level
  const tiers = [1, 2, 3, 4];

  return (
    <div className="border-t border-[#a9b4b9]/10">
      {/* Trade commissions */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Trade Commissions</p>
        <p className="text-[11px] text-[#a9b4b9] mt-0.5">Share of platform revenue per trade</p>
      </div>
      <div className="divide-y divide-[#a9b4b9]/10">
        {tiers.map((level) => {
          const direct = tradeFees.find(f => f.level === level && f.depth === 1);
          const indirect = tradeFees.find(f => f.level === level && f.depth === 2);
          return (
            <div key={`trade-${level}`} className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-[#2a3439]">
                  L{level} &middot; {TIER_NAMES[level]}
                </span>
                <span className="text-[10px] text-[#a9b4b9]">{TIER_VOLUME[level]} volume</span>
              </div>
              <div className="flex gap-2">
                {direct && (
                  <button
                    onClick={() => onEditFee(direct)}
                    className="flex-1 flex items-center justify-between bg-[#f0f4f7]/60 hover:bg-[#e8eff3] rounded-lg px-3 py-2.5 transition-colors cursor-pointer group"
                  >
                    <span className="text-xs text-[#566166]">Direct</span>
                    <span className="text-sm font-bold font-[family-name:var(--font-manrope)] text-[var(--yes)] tabular-nums group-hover:underline">
                      {(direct.rate * 100).toFixed(0)}%
                    </span>
                  </button>
                )}
                {indirect && (
                  <button
                    onClick={() => onEditFee(indirect)}
                    className="flex-1 flex items-center justify-between bg-[#f0f4f7]/60 hover:bg-[#e8eff3] rounded-lg px-3 py-2.5 transition-colors cursor-pointer group"
                  >
                    <span className="text-xs text-[#566166]">Indirect</span>
                    <span className="text-sm font-bold font-[family-name:var(--font-manrope)] text-[var(--yes)] tabular-nums group-hover:underline">
                      {(indirect.rate * 100).toFixed(0)}%
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resolution commissions */}
      {resolutionFees.length > 0 && (
        <>
          <div className="px-5 pt-4 pb-2 border-t border-[#a9b4b9]/10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Resolution Commissions</p>
            <p className="text-[11px] text-[#a9b4b9] mt-0.5">Share of resolution fee revenue at payout</p>
          </div>
          <div className="divide-y divide-[#a9b4b9]/10">
            {tiers.map((level) => {
              const direct = resolutionFees.find(f => f.level === level && f.depth === 1);
              const indirect = resolutionFees.find(f => f.level === level && f.depth === 2);
              if (!direct && !indirect) return null;
              return (
                <div key={`res-${level}`} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-[#2a3439]">
                      L{level} &middot; {TIER_NAMES[level]}
                    </span>
                    <span className="text-[10px] text-[#a9b4b9]">{TIER_VOLUME[level]} volume</span>
                  </div>
                  <div className="flex gap-2">
                    {direct && (
                      <button
                        onClick={() => onEditFee(direct)}
                        className="flex-1 flex items-center justify-between bg-[#f0f4f7]/60 hover:bg-[#e8eff3] rounded-lg px-3 py-2.5 transition-colors cursor-pointer group"
                      >
                        <span className="text-xs text-[#566166]">Direct</span>
                        <span className="text-sm font-bold font-[family-name:var(--font-manrope)] text-[var(--yes)] tabular-nums group-hover:underline">
                          {(direct.rate * 100).toFixed(0)}%
                        </span>
                      </button>
                    )}
                    {indirect && (
                      <button
                        onClick={() => onEditFee(indirect)}
                        className="flex-1 flex items-center justify-between bg-[#f0f4f7]/60 hover:bg-[#e8eff3] rounded-lg px-3 py-2.5 transition-colors cursor-pointer group"
                      >
                        <span className="text-xs text-[#566166]">Indirect</span>
                        <span className="text-sm font-bold font-[family-name:var(--font-manrope)] text-[var(--yes)] tabular-nums group-hover:underline">
                          {(indirect.rate * 100).toFixed(0)}%
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Info note */}
      <div className="px-5 py-3 bg-[#f0f4f7]/40 border-t border-[#a9b4b9]/10">
        <p className="text-[11px] text-[#566166]">
          Agents earn a share of platform revenue on each trade their referrals make. Rates vary by agent tier (network volume) and referral layer (direct or indirect).
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

export function FeeConfigEditor({ fees }: FeeConfigEditorProps) {
  const [editingFee, setEditingFee] = useState<FeeRow | null>(null);

  // Split fees into groups
  const commissionFees = fees.filter(f =>
    f.fee_type === "ngr_commission" || f.fee_type === "ngr_resolution_commission"
  );
  const platformFees = fees.filter(f =>
    f.fee_type !== "ngr_commission" && f.fee_type !== "ngr_resolution_commission"
  );

  // Build a lookup for each group
  function getFeesForGroup(group: FeeGroup): FeeRow[] {
    if (group.isCommission) return [];
    return group.types
      .map(type => platformFees.find(f => f.fee_type === type))
      .filter((f): f is FeeRow => f !== undefined);
  }

  // Catch any platform fees not in a defined group
  const groupedTypes = new Set(FEE_GROUPS.flatMap(g => g.types));
  const ungrouped = platformFees.filter(f => !groupedTypes.has(f.fee_type));

  return (
    <>
      <div className="space-y-4">
        {FEE_GROUPS.map((group, i) => (
          <CollapsibleSection
            key={group.key}
            group={group}
            fees={getFeesForGroup(group)}
            defaultOpen={i === 0}
            onEditFee={setEditingFee}
            commissionFees={group.isCommission ? commissionFees : undefined}
          />
        ))}

        {/* Any ungrouped fees (safety net) */}
        {ungrouped.length > 0 && (
          <CollapsibleSection
            group={{
              key: "other",
              title: "Other",
              subtitle: "Additional fee configurations",
              icon: "more_horiz",
              types: [],
            }}
            fees={ungrouped}
            defaultOpen={false}
            onEditFee={setEditingFee}
          />
        )}
      </div>

      {/* Edit dialog */}
      {editingFee && (
        <EditFeeDialog
          fee={editingFee}
          open={!!editingFee}
          onOpenChange={(open) => !open && setEditingFee(null)}
        />
      )}
    </>
  );
}
