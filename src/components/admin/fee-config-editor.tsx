"use client";

import { useState } from "react";
import { EditFeeDialog } from "@/components/admin/edit-fee-dialog";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface FeeRow {
  // v1 fee_config has no `id`, no `level`/`depth` (commission system stripped).
  fee_type: string;
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
//
// W3 strip: agent commissions removed entirely (branches, multi-level
// referral system gone). Speed-mode runtime knobs added.

interface FeeGroup {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  types: string[];
}

const FEE_GROUPS: FeeGroup[] = [
  {
    key: "money",
    title: "Deposits & Withdrawals",
    subtitle: "Fees on money in and out",
    icon: "account_balance",
    types: ["deposit_fee", "withdrawal_fee"],
  },
  {
    key: "speed",
    title: "Speed Mode",
    subtitle: "Master kill switch + oracle freshness gate",
    icon: "bolt",
    types: ["speed_markets_enabled", "speed_oracle_stale_seconds"],
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
}: {
  group: FeeGroup;
  fees: FeeRow[];
  defaultOpen: boolean;
  onEditFee: (fee: FeeRow) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const count = fees.length;

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
          <div className="border-t border-[#a9b4b9]/10 divide-y divide-[#a9b4b9]/10">
            {fees.map((fee) => (
              <FeeItem key={fee.fee_type} fee={fee} onClick={() => onEditFee(fee)} />
            ))}
            {fees.length === 0 && (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-[#566166]">No fees configured</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Main component ─────────────────────────────────────────────

export function FeeConfigEditor({ fees }: FeeConfigEditorProps) {
  const [editingFee, setEditingFee] = useState<FeeRow | null>(null);

  function getFeesForGroup(group: FeeGroup): FeeRow[] {
    return group.types
      .map((type) => fees.find((f) => f.fee_type === type))
      .filter((f): f is FeeRow => f !== undefined);
  }

  const groupedTypes = new Set(FEE_GROUPS.flatMap((g) => g.types));
  const ungrouped = fees.filter((f) => !groupedTypes.has(f.fee_type));

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
          />
        ))}

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
