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
  // ── Speed master switches (mig 0028+) ──
  speed_markets_enabled:         { label: "Master Kill Switch",         hint: "When 0, trade RPC rejects all new bets. Cashouts + resolution stay live." },
  speed_oracle_stale_seconds:    { label: "Oracle Freshness Gate",      hint: "Reject trades when oracle tick older than N seconds." },
  speed_cashout_enabled:         { label: "Cashout Kill Switch",        hint: "When 0, cashout RPC rejects all attempts." },
  // ── Per-user / per-market caps (mig 0027+) ──
  speed_stake_max_5m_usd:        { label: "Per-Bet Max — 5m markets",   hint: "Single-bet ceiling for 5m duration. Server enforces." },
  speed_stake_max_1h_usd:        { label: "Per-Bet Max — 1h markets",   hint: "Single-bet ceiling for 1h duration." },
  speed_stake_max_usd:           { label: "Per-Bet Max (legacy)",       hint: "Pre-mig-0027 single-bet cap. Use per-duration keys instead." },
  speed_cap_per_side_usd:        { label: "Per-Side Cap (per market)",  hint: "Per-user, per-market, per-side cap. Resets every market cycle." },
  speed_per_user_per_market_cap_usd: { label: "Per-User Per-Market Cap", hint: "Per-user, per-market, per-side cap (mig 0028 canonical name)." },
  // ── Pool-wide risk caps (mig 0028) ──
  speed_pool_collateral_usd:     { label: "Pool Collateral",            hint: "Notional pool backing speed markets. Used for percentage caps below." },
  speed_per_side_cap_pct:        { label: "Per-Side Cap (% of pool)",   hint: "When stake on one side hits this fraction of pool, no more bets." },
  speed_same_strike_cluster_cap_pct: { label: "Same-Strike Cluster Cap (% of pool)", hint: "Max exposure across markets sharing one strike." },
  speed_daily_ngr_floor_usd:     { label: "Daily NGR Floor",            hint: "Circuit breaker. When daily NGR crosses (negative), new entries blocked. Auto-resets UTC midnight." },
  // ── Pricing engine v2 (mig 0028) ──
  speed_spread_pct:              { label: "Base Spread",                hint: "Half-spread baked into offered_prob each side. Default 0.05 = 5%." },
  speed_extreme_spread_coeff:    { label: "Extreme Spread Coeff",       hint: "Quadratic widening beyond ±0.45 from 0.5 fair_prob." },
  speed_late_60s_spread_mult:    { label: "Late 60s Spread Mult",       hint: "Spread × this in last 60s of round. Default 1.4." },
  speed_late_30s_spread_mult:    { label: "Late 30s Spread Mult",       hint: "Spread × this in last 30s of round. Default 1.8." },
  speed_fair_prob_reject_high:   { label: "Fair Prob Reject — High",    hint: "Reject entry when fair_prob_side > this. Replaces the 0.99 saturation clamp." },
  speed_fair_prob_reject_low:    { label: "Fair Prob Reject — Low",     hint: "Reject entry when fair_prob_side < this. Mirror of high threshold." },
  speed_late_30s_imbalance_reject: { label: "Late 30s Imbalance Reject", hint: "In last 30s, reject entry when |fair − 0.5| exceeds this. Closes deep-tail exploit." },
  speed_cashout_late_30s_imbalance_reject: { label: "Late 30s Cashout Imbalance Reject", hint: "In last 30s, reject cashout when |mark − 0.5| exceeds this." },
  speed_cashout_late_reject_s:   { label: "Cashout Late Reject (sec)",  hint: "Reject cashouts when seconds remaining is below this. Default 10." },
  // ── Cashout option-C margins (mig 0028) ──
  speed_cashout_winning_base_5m: { label: "Cashout Winning Base — 5m",  hint: "Margin extracted from winning side cashout, 5m duration. Default 2.5%." },
  speed_cashout_winning_base_1h: { label: "Cashout Winning Base — 1h",  hint: "Margin extracted from winning side cashout, 1h duration. Default 3.0%." },
  speed_cashout_losing_base_5m:  { label: "Cashout Losing Base — 5m",   hint: "Margin amplifying losing side cashout, 5m duration. Default 8.0%." },
  speed_cashout_losing_base_1h:  { label: "Cashout Losing Base — 1h",   hint: "Margin amplifying losing side cashout, 1h duration. Default 9.0%." },
  speed_cashout_saturation_coef: { label: "Saturation Coef (winning)",  hint: "Premium added when |mark − 0.5| > 0.35 on winning side." },
  speed_cashout_desperation_coef: { label: "Desperation Coef (losing)", hint: "Premium added when mark < 0.5 on losing side." },
  speed_cashout_late_window_winning_coef: { label: "Late Window Coef — Winning", hint: "Margin ramp on winning side as time runs out (× (60-s)/60)." },
  speed_cashout_late_window_losing_coef:  { label: "Late Window Coef — Losing",  hint: "Margin ramp on losing side as time runs out." },
  // ── IV / parity (mig 0029, 0030) ──
  speed_iv_btc:                  { label: "IV Fallback (BTC)",          hint: "Constant IV used when realized-vol cache is stale or empty." },
  speed_iv_drift_tolerance_pct:  { label: "IV Drift Tolerance",         hint: "Stale-quote check. If client_iv drifts beyond this, reject with IV_DRIFT." },
  speed_iv_fail_closed:          { label: "IV Fail-Closed Mode",        hint: "When 1, reject trades if RV cache is stale (no fallback). Operational gate." },
  speed_use_realized_vol:        { label: "Use Realized Vol",           hint: "Master switch. When 0, server bypasses RV cache and uses speed_iv_btc directly." },
  // ── Soft guards (mig 0031) ──
  speed_per_user_velocity_max:   { label: "Velocity Cap (bets/min)",    hint: "Hard reject when user exceeds this many bets per rolling minute." },
  speed_per_user_open_exposure_pct: { label: "Open Exposure Cap (% of pool)", hint: "Hard reject when user's total open liability exceeds this fraction of pool." },
  speed_per_user_daily_handle_alert: { label: "Daily Handle Alert ($)", hint: "Telemetry-only. Logs to speed_user_alerts when daily handle crosses this. No enforcement." },
  // ── Mig 0034: matrix pricing flags ──
  speed_pricing_matrix_enabled:        { label: "Matrix Pricing — Master",     hint: "DANGER ZONE: enable matrix-based pricing for entry AND cashout TOGETHER. Default 0 (BSM only)." },
  speed_pricing_asym_pushup_enabled:   { label: "Asymmetric Push-Up Rule",     hint: "When matrix enabled, max(matrix, BSM) is used so pricing only ever raises (codex required)." },
  speed_pricing_matrix_version:        { label: "Active Matrix Version",       hint: "Auto-set by recalibration cron. Read-only in practice." },
  speed_pricing_matrix_min_n_eff:      { label: "Matrix Min N (markets)",      hint: "Cells with fewer than this many independent markets fall back to BSM." },
  speed_pricing_matrix_ci_max_width:   { label: "Matrix Max CI Width",         hint: "Cells with CI width above this shrink hard toward BSM prior." },
  speed_pricing_matrix_prior_n:        { label: "Matrix Prior Weight",         hint: "Bayesian shrinkage weight (toward 0.5 neutral)." },
  // ── Mig 0034: soft-block ──
  speed_entry_soft_block_enabled:           { label: "Entry Soft-Block Enabled",      hint: "DANGER ZONE: when 1, RPC raises SOFT_BLOCK and UI greys button when offered_prob >= threshold." },
  speed_entry_soft_block_threshold:         { label: "Entry Soft-Block Threshold",    hint: "Lock at offered_prob >= this. Default 0.95." },
  speed_entry_soft_block_unlock_threshold:  { label: "Entry Soft-Block Unlock",       hint: "Hysteresis unlock — must drop below this to release. Default 0.94." },
  // ── Mig 0034: per-ticket payout caps ──
  speed_entry_max_payout_usd_5m: { label: "Per-Ticket Payout Cap — 5m",  hint: "Reject any single 5m ticket where stake / offered_prob exceeds this." },
  speed_entry_max_payout_usd_1h: { label: "Per-Ticket Payout Cap — 1h",  hint: "Reject any single 1h ticket where payout exceeds this." },
  // ── Mig 0034: cashout cap-edge ──
  speed_cashout_cap_edge_threshold: { label: "Cashout Cap-Edge Threshold", hint: "When entry AND mark prob both >= this, cashout disabled with 'Hold for settlement'." },
  // ── Mig 0034: three-tier NGR breaker ──
  speed_daily_ngr_alert_usd:     { label: "NGR Tier 1 — Alert",      hint: "Slack notification, no enforcement. Default -$500." },
  speed_daily_ngr_soft_block_usd:{ label: "NGR Tier 2 — Soft Block", hint: "Per-trade max temporarily reduced. Default -$2,500." },
  speed_daily_ngr_hard_stop_usd: { label: "NGR Tier 3 — Hard Stop",  hint: "Trading paused entirely until manual review. Default -$5,000." },
  speed_ngr_soft_block_stake_max_usd: { label: "NGR Soft-Block Stake Max", hint: "Per-trade stake cap when NGR soft-block tier is active. Default $100." },
};

// Keys whose `rate` column stores a USD amount (not a 0–1 fraction). Format
// these as currency in the list and in the edit dialog.
const CURRENCY_KEYS = new Set<string>([
  "speed_stake_max_usd",
  "speed_stake_max_5m_usd",
  "speed_stake_max_1h_usd",
  "speed_cap_per_side_usd",
  "speed_per_user_per_market_cap_usd",
  "speed_pool_collateral_usd",
  "speed_daily_ngr_floor_usd",
  "speed_per_user_daily_handle_alert",
  // Mig 0034
  "speed_entry_max_payout_usd_5m",
  "speed_entry_max_payout_usd_1h",
  "speed_daily_ngr_alert_usd",
  "speed_daily_ngr_soft_block_usd",
  "speed_daily_ngr_hard_stop_usd",
  "speed_ngr_soft_block_stake_max_usd",
]);

// Keys whose `rate` is a raw count or seconds, formatted plainly (no % / $).
const PLAIN_NUMBER_KEYS = new Set<string>([
  "speed_oracle_stale_seconds",
  "speed_cashout_late_reject_s",
  "speed_per_user_velocity_max",
  "speed_extreme_spread_coeff",
  // Mig 0034
  "speed_pricing_matrix_version",
  "speed_pricing_matrix_min_n_eff",
  "speed_pricing_matrix_prior_n",
]);

// Keys whose `rate` is a multiplier (e.g. 1.4 for 1.4×).
const MULTIPLIER_KEYS = new Set<string>([
  "speed_late_60s_spread_mult",
  "speed_late_30s_spread_mult",
]);

function formatRate(fee: FeeRow): string {
  if (fee.fee_type === "dynamic_spread_multiplier") return `${Number(fee.rate)}x`;
  if (fee.fee_type === "amm_default_b" || fee.fee_type === "min_trade_amount")
    return `${Number(fee.rate)}`;
  if (CURRENCY_KEYS.has(fee.fee_type)) {
    const v = Number(fee.rate);
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  if (MULTIPLIER_KEYS.has(fee.fee_type)) {
    return `${Number(fee.rate).toFixed(2)}×`;
  }
  if (PLAIN_NUMBER_KEYS.has(fee.fee_type)) {
    return `${Number(fee.rate)}`;
  }
  if (fee.fee_type === "speed_markets_enabled" || fee.fee_type === "speed_cashout_enabled" ||
      fee.fee_type === "speed_use_realized_vol" || fee.fee_type === "speed_iv_fail_closed" ||
      fee.fee_type === "speed_pricing_matrix_enabled" ||
      fee.fee_type === "speed_pricing_asym_pushup_enabled" ||
      fee.fee_type === "speed_entry_soft_block_enabled") {
    return Number(fee.rate) === 0 ? "OFF" : "ON";
  }
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
    key: "speed_master",
    title: "Speed Master Switches",
    subtitle: "Kill switches + oracle freshness gate",
    icon: "bolt",
    types: [
      "speed_markets_enabled",
      "speed_cashout_enabled",
      "speed_oracle_stale_seconds",
    ],
  },
  {
    key: "speed_stake_caps",
    title: "Speed Stake Caps",
    subtitle: "Per-bet ceilings and per-user-per-market caps",
    icon: "shield",
    types: [
      "speed_stake_max_5m_usd",
      "speed_stake_max_1h_usd",
      "speed_per_user_per_market_cap_usd",
      "speed_cap_per_side_usd",
      "speed_stake_max_usd",
    ],
  },
  {
    key: "speed_pool_caps",
    title: "Speed Pool Caps",
    subtitle: "Pool-wide collateral and exposure limits (mig 0028)",
    icon: "account_balance_wallet",
    types: [
      "speed_pool_collateral_usd",
      "speed_per_side_cap_pct",
      "speed_same_strike_cluster_cap_pct",
      "speed_daily_ngr_floor_usd",
    ],
  },
  {
    key: "speed_pricing",
    title: "Speed Pricing Engine",
    subtitle: "Spread, late-window mults, hard-reject thresholds (mig 0028)",
    icon: "tune",
    types: [
      "speed_spread_pct",
      "speed_extreme_spread_coeff",
      "speed_late_60s_spread_mult",
      "speed_late_30s_spread_mult",
      "speed_fair_prob_reject_high",
      "speed_fair_prob_reject_low",
      "speed_late_30s_imbalance_reject",
      "speed_cashout_late_30s_imbalance_reject",
      "speed_cashout_late_reject_s",
    ],
  },
  {
    key: "speed_cashout_margins",
    title: "Speed Cashout Margins",
    subtitle: "Profit-based margin (option C, mig 0028)",
    icon: "redeem",
    types: [
      "speed_cashout_winning_base_5m",
      "speed_cashout_winning_base_1h",
      "speed_cashout_losing_base_5m",
      "speed_cashout_losing_base_1h",
      "speed_cashout_saturation_coef",
      "speed_cashout_desperation_coef",
      "speed_cashout_late_window_winning_coef",
      "speed_cashout_late_window_losing_coef",
    ],
  },
  {
    key: "speed_iv",
    title: "Speed IV / Volatility",
    subtitle: "RV cache controls and parity tolerances (mig 0029, 0030)",
    icon: "timeline",
    types: [
      "speed_use_realized_vol",
      "speed_iv_fail_closed",
      "speed_iv_btc",
      "speed_iv_drift_tolerance_pct",
    ],
  },
  {
    key: "speed_soft_guards",
    title: "Speed Soft Guards",
    subtitle: "Per-user velocity, exposure, and daily-handle alerts (mig 0031)",
    icon: "speed",
    types: [
      "speed_per_user_velocity_max",
      "speed_per_user_open_exposure_pct",
      "speed_per_user_daily_handle_alert",
    ],
  },
  // ── Mig 0034: pricing engine v3 ──
  {
    key: "speed_matrix_pricing",
    title: "Speed Matrix Pricing (mig 0034)",
    subtitle: "Empirical-matrix pricing + asymmetric push-up + soft-block. DANGER ZONE.",
    icon: "matrix",
    types: [
      "speed_pricing_matrix_enabled",
      "speed_pricing_asym_pushup_enabled",
      "speed_pricing_matrix_version",
      "speed_pricing_matrix_min_n_eff",
      "speed_pricing_matrix_ci_max_width",
      "speed_pricing_matrix_prior_n",
      "speed_entry_soft_block_enabled",
      "speed_entry_soft_block_threshold",
      "speed_entry_soft_block_unlock_threshold",
      "speed_cashout_cap_edge_threshold",
    ],
  },
  {
    key: "speed_payout_caps",
    title: "Speed Per-Ticket Payout Caps (mig 0034)",
    subtitle: "Maximum gross payout per single ticket — blast-radius cap",
    icon: "shield",
    types: [
      "speed_entry_max_payout_usd_5m",
      "speed_entry_max_payout_usd_1h",
    ],
  },
  {
    key: "speed_ngr_breaker",
    title: "Speed Three-Tier NGR Breaker (mig 0034)",
    subtitle: "Alert / soft-block / hard-stop tiers when daily NGR drops",
    icon: "warning",
    types: [
      "speed_daily_ngr_alert_usd",
      "speed_daily_ngr_soft_block_usd",
      "speed_daily_ngr_hard_stop_usd",
      "speed_ngr_soft_block_stake_max_usd",
    ],
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
