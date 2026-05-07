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
//
// Every fee_config key gets a plain-English title and a description an
// admin without engineering background can act on. The pattern: title is
// what this control IS; description is WHEN it fires and WHAT happens
// when you change it.

const FEE_LABELS: Record<string, { label: string; hint: string }> = {
  // ── Generic platform fees ─────────────────────────────────────
  explicit_fee: {
    label: "Trading Fee",
    hint: "Charged on every buy and sell. Higher value = more revenue per trade but discourages high-volume traders.",
  },
  cash_out_premium: {
    label: "Cash-Out Surcharge",
    hint: "Extra fee added when a user sells shares early. Higher value = more friction on early exits.",
  },
  resolution_fee: {
    label: "Winning Payout Fee",
    hint: "Cut taken from winning payouts at market resolution. Charges only the winners; losers pay nothing extra.",
  },
  deposit_fee: {
    label: "Deposit Fee",
    hint: "Fee taken on every incoming deposit. Usually 0% — set higher only if a payment provider charges us per deposit.",
  },
  withdrawal_fee: {
    label: "Withdrawal Fee",
    hint: "Fee taken on every outgoing withdrawal. Covers blockchain gas / transfer costs we incur.",
  },
  amm_default_b: {
    label: "Market Liquidity Setting",
    hint: "Controls how much prices move when someone buys or sells. Lower = sharper price moves; higher = smoother prices.",
  },
  max_trade_pct: {
    label: "Maximum Trade Size",
    hint: "Largest single trade allowed, shown as a percent of total market liquidity. Protects markets from one whale draining a side.",
  },
  dynamic_spread_threshold: {
    label: "Spread Widening Trigger",
    hint: "Price level where the spread starts widening. Once a market gets close to 0% or 100%, the gap between buy and sell price grows.",
  },
  dynamic_spread_multiplier: {
    label: "Spread Widening Strength",
    hint: "How aggressively the spread widens once the threshold is hit. Higher = more protective of the platform; sharper prices for users.",
  },
  min_trade_amount: {
    label: "Minimum Trade Size",
    hint: "Smallest amount a user can stake on a single trade. Stops dust trades that clog the database.",
  },

  // ── Speed master switches (mig 0028+) ─────────────────────────
  speed_markets_enabled: {
    label: "Speed Markets — Master On/Off",
    hint: "When OFF, no new Speed bets can be placed at all. Existing positions still resolve and cash out normally. Use as the nuclear option if something is wrong with trading.",
  },
  speed_oracle_stale_seconds: {
    label: "Live Price Freshness (seconds)",
    hint: "If our BTC price feed is older than this many seconds, new trades are rejected to protect against stale-price arbitrage. Default 2 seconds.",
  },
  speed_cashout_enabled: {
    label: "Cashout — On/Off",
    hint: "When OFF, no user can cash out a position early — they must hold to settlement. Use this if cashout pricing looks wrong; entries keep working.",
  },

  // ── Per-user / per-market caps (mig 0027+) ────────────────────
  speed_stake_max_5m_usd: {
    label: "Maximum Bet — 5-Minute Markets",
    hint: "Largest amount a user can stake on a single 5-minute trade. Raise to allow bigger trades; lower to limit individual exposure.",
  },
  speed_stake_max_1h_usd: {
    label: "Maximum Bet — 1-Hour Markets",
    hint: "Largest amount a user can stake on a single 1-hour trade.",
  },
  speed_stake_max_usd: {
    label: "Maximum Bet — Legacy Default",
    hint: "Old single-bet cap, used as a fallback. Prefer the per-duration keys above; this only applies if no per-duration value is set.",
  },
  speed_cap_per_side_usd: {
    label: "Per-Market Cap (one user, one side)",
    hint: "How much one user can stake on one side (over OR under) of a single market, across multiple bets. Stops a single user from cornering one side.",
  },
  speed_per_user_per_market_cap_usd: {
    label: "Per-Market Cap (canonical)",
    hint: "Same as the cap above; this is the newer name in the database. Both keys map to the same limit.",
  },

  // ── Pool-wide risk caps (mig 0028) ────────────────────────────
  speed_pool_collateral_usd: {
    label: "Pool Size (USD)",
    hint: "Total notional pool backing all Speed markets. Several caps below are calculated as a percentage of this number. Raising it allows bigger total exposure.",
  },
  speed_per_side_cap_pct: {
    label: "Per-Market Side Exposure Cap",
    hint: "Maximum total liability the platform will accept on one side of a single market, as a fraction of the pool. Default 25% — once payouts on one side reach this, no more bets accepted on that side.",
  },
  speed_same_strike_cluster_cap_pct: {
    label: "Same-Strike Cluster Cap",
    hint: "When several markets share roughly the same strike price, this caps total exposure across them combined. Stops a coordinated bet across many same-strike markets.",
  },
  speed_daily_ngr_floor_usd: {
    label: "Daily Loss Limit (Circuit Breaker)",
    hint: "If our daily net revenue drops below this (negative number, like -$5,000), trading pauses until UTC midnight. Auto-resets each day.",
  },

  // ── Pricing engine v2 (mig 0028) ──────────────────────────────
  speed_spread_pct: {
    label: "Base Spread",
    hint: "The platform's edge baked into every quote. Default 5%. Higher = more profit per trade but visibly worse user prices.",
  },
  speed_extreme_spread_coeff: {
    label: "Lopsided-Market Spread Boost",
    hint: "How much we widen the spread when a market is heavily on one side. Higher value = even fairer protection at extremes; users see worse prices on near-certain markets.",
  },
  speed_late_60s_spread_mult: {
    label: "Last 60 Seconds Spread Multiplier",
    hint: "Multiplies the base spread when a market has under 60 seconds left. Currently 1.2× (was 1.4× pre-Mig 0034 — reduced because the matrix already handles late-window directional pricing).",
  },
  speed_late_30s_spread_mult: {
    label: "Last 30 Seconds Spread Multiplier",
    hint: "Multiplies the base spread in the final 30 seconds of a round. Currently 1.4× (was 1.8× pre-Mig 0034). Together with the 60s multiplier, makes late trades less profitable.",
  },
  speed_fair_prob_reject_high: {
    label: "Reject Bets Above (Probability)",
    hint: "If our internal probability for a side exceeds this, we refuse the trade with 'outcome too close to certain'. Default 0.97 = 97%.",
  },
  speed_fair_prob_reject_low: {
    label: "Reject Bets Below (Probability)",
    hint: "If our internal probability for a side falls below this, we refuse the trade with 'side too unlikely'. Mirror of the high threshold. Default 0.03 = 3%.",
  },
  speed_late_30s_imbalance_reject: {
    label: "Last 30s — Reject Lopsided Trades",
    hint: "In the final 30 seconds, reject any trade where the implied probability is more than this far from 50/50. Closes the 'pattern-match the obvious side at expiry' exploit.",
  },
  speed_cashout_late_30s_imbalance_reject: {
    label: "Last 30s — Reject Lopsided Cashouts",
    hint: "Mirror of the entry rule but for cashouts. In the final 30 seconds, lopsided positions can't be cashed out — they must run to settlement.",
  },
  speed_cashout_late_reject_s: {
    label: "Last N Seconds — Block All Cashouts",
    hint: "Cashouts are completely disabled in the last N seconds before a market closes. Default 10 seconds.",
  },

  // ── Cashout margins (mig 0028) ────────────────────────────────
  speed_cashout_winning_base_5m: {
    label: "Winning Cashout Margin — 5m Markets",
    hint: "Cut we take when a user cashes out a winning 5-minute position. Default 2.5%. Hidden from users; baked into the cashout amount.",
  },
  speed_cashout_winning_base_1h: {
    label: "Winning Cashout Margin — 1h Markets",
    hint: "Same as above but for 1-hour markets. Slightly higher (3%) because 1h positions have wider price swings.",
  },
  speed_cashout_losing_base_5m: {
    label: "Losing Cashout Margin — 5m Markets",
    hint: "Slippage applied when a user cuts a losing 5-minute position. Default 8%. Higher than winning side because losing users want to exit fast.",
  },
  speed_cashout_losing_base_1h: {
    label: "Losing Cashout Margin — 1h Markets",
    hint: "Slippage on losing cashouts for 1-hour markets. Default 9%.",
  },
  speed_cashout_saturation_coef: {
    label: "Winning Cashout — Lopsided Premium",
    hint: "Adds extra margin when a winning user cashes out from a heavily one-sided market (very high probability of winning). Larger value = more aggressive house edge near the rails.",
  },
  speed_cashout_desperation_coef: {
    label: "Losing Cashout — Desperation Premium",
    hint: "Adds extra slippage when a losing user is panicking out of a position that's looking very bad. Larger value = users pay more to escape losing trades.",
  },
  speed_cashout_late_window_winning_coef: {
    label: "Winning Cashout — Late Window Premium",
    hint: "Adds extra margin to winning cashouts as the market gets close to expiry. Encourages users to ride to settlement instead of cashing out at the last moment.",
  },
  speed_cashout_late_window_losing_coef: {
    label: "Losing Cashout — Late Window Premium",
    hint: "Adds extra slippage to losing cashouts near expiry. Discourages last-second loss-cutting.",
  },

  // ── IV / volatility (mig 0029) ────────────────────────────────
  speed_iv_btc: {
    label: "BTC Volatility — Fallback Value",
    hint: "Constant volatility number used when our live volatility cache is stale or empty. 0.6 = 60% annualized, a reasonable BTC default. Only matters during outages of the volatility worker.",
  },
  speed_iv_drift_tolerance_pct: {
    label: "Volatility Drift Tolerance",
    hint: "If a user's quoted volatility drifts more than this from our current value, the trade is rejected as a stale quote. Default 10%.",
  },
  speed_iv_fail_closed: {
    label: "Volatility Cache — Strict Mode",
    hint: "When ON, trades are rejected if the live volatility cache is stale (no fallback to the BTC default). When OFF, falls back to the BTC default value above. OFF is more user-friendly; ON is safer for the platform.",
  },
  speed_use_realized_vol: {
    label: "Use Live Volatility (vs Fixed)",
    hint: "Master switch for live volatility. When ON, prices update with real-time BTC volatility from the cache. When OFF, prices use the fixed BTC fallback value. Always leave ON in production.",
  },

  // ── Soft guards (mig 0031) ────────────────────────────────────
  speed_per_user_velocity_max: {
    label: "Maximum Bets Per Minute (per user)",
    hint: "Hard limit on how fast one user can place bets. Default 30 per minute. Catches automated bots and rapid-fire stake increases.",
  },
  speed_per_user_open_exposure_pct: {
    label: "Per-User Open Position Cap",
    hint: "Maximum total liability one user can have across all open positions, as a fraction of the pool. Default 15%. Prevents a single user from being able to bankrupt the platform.",
  },
  speed_per_user_daily_handle_alert: {
    label: "Daily Volume Alert (per user)",
    hint: "When a single user trades more than this much in a day, we log a telemetry alert for review. No enforcement — just a tripwire. Default $5,000.",
  },

  // ── Mig 0034: matrix pricing flags ────────────────────────────
  speed_pricing_matrix_enabled: {
    label: "⚠️ Matrix Pricing — Master Switch",
    hint: "DANGER ZONE. Turns on data-driven pricing using historical outcomes. Affects BOTH entry pricing AND cashout pricing together (they cannot be split). When ON, prices in qualifying cells push toward realized historical win rates rather than pure Black-Scholes. When OFF, falls back to the textbook formula.",
  },
  speed_pricing_asym_pushup_enabled: {
    label: "Matrix — Only Push Prices Up",
    hint: "When ON, the matrix only ever RAISES the price (never gives users better odds than the textbook). This is the safer, house-protective mode. Should always be ON when the matrix is enabled. Required for legal/regulatory framing.",
  },
  speed_pricing_matrix_version: {
    label: "Active Matrix Version (auto)",
    hint: "Which matrix snapshot is currently being used by the pricing engine. Set automatically by the nightly recalibration cron. Don't edit manually unless rolling back to an older matrix version.",
  },
  speed_pricing_matrix_min_n_eff: {
    label: "Matrix Cell — Minimum Markets Required",
    hint: "How many independent markets must contribute data to a matrix cell before that cell is trusted. Default 100. Cells below this fall back to the textbook formula. Lower = use matrix sooner with less data; higher = more conservative.",
  },
  speed_pricing_matrix_ci_max_width: {
    label: "Matrix Cell — Maximum Uncertainty",
    hint: "Cells whose statistical confidence interval is wider than this (default 12%) get shrunk hard toward the textbook prior. Lower = stricter; higher = trusts noisier estimates more.",
  },
  speed_pricing_matrix_prior_n: {
    label: "Matrix — Prior Strength",
    hint: "How strongly the Bayesian average pulls toward 50/50 when we have little data. Default 50 (treats the prior as equivalent to 50 markets of evidence at 50/50). Higher = more skepticism of new data; lower = trusts new data sooner.",
  },

  // ── Mig 0034: soft-block ──────────────────────────────────────
  speed_entry_soft_block_enabled: {
    label: "⚠️ Soft-Block — On/Off",
    hint: "DANGER ZONE. When ON, the trade button greys out with 'Market closing — try next round' once the offered probability gets very high. Friendly UX; not an error. Closes the late-window pattern-match exploit. Should only be turned on when the matrix is also on.",
  },
  speed_entry_soft_block_threshold: {
    label: "Soft-Block — Trigger Probability",
    hint: "When the offered probability hits this number or higher, the trade button locks. Default 0.95 = 95%. Lower this if you want to block more aggressively; raise to allow more high-confidence trades.",
  },
  speed_entry_soft_block_unlock_threshold: {
    label: "Soft-Block — Unlock Probability",
    hint: "Once locked, the button stays greyed out until the offered probability drops below this number. Default 0.94 = 94%. Prevents the button from flickering on and off as the price wobbles around the trigger.",
  },

  // ── Mig 0034: per-ticket payout caps ──────────────────────────
  speed_entry_max_payout_usd_5m: {
    label: "Maximum Single-Ticket Payout — 5m",
    hint: "Hard cap on how much any single 5-minute ticket can pay out at settlement. Even if the stake × odds would produce more, the trade is rejected with 'stake too large for these odds'. Default $2,500. Caps the worst-case loss on a single trade.",
  },
  speed_entry_max_payout_usd_1h: {
    label: "Maximum Single-Ticket Payout — 1h",
    hint: "Same as above but for 1-hour markets. Default $5,000.",
  },

  // ── Mig 0034: cashout cap-edge ────────────────────────────────
  speed_cashout_cap_edge_threshold: {
    label: "Cashout — Hold-To-Settlement Threshold",
    hint: "When both the user's entry probability and the current mark probability are above this number (default 0.985), cashout is disabled and the UI shows 'Hold for settlement — pays $X'. Prevents the awkward 'cashout = stake' scenario when the position is already at the price ceiling.",
  },

  // ── Mig 0034: three-tier daily loss breaker ───────────────────
  speed_daily_ngr_alert_usd: {
    label: "Daily Loss — Tier 1: Alert",
    hint: "When daily losses cross this threshold (negative number, e.g. -$500), a Slack notification fires. No effect on trading — just an early-warning signal that the day is going badly.",
  },
  speed_daily_ngr_soft_block_usd: {
    label: "Daily Loss — Tier 2: Reduce Stake Limits",
    hint: "When daily losses cross this (e.g. -$2,500), per-trade maximum stakes are temporarily reduced to the 'soft-block stake max' value below. Caps the bleed without fully halting trading.",
  },
  speed_daily_ngr_hard_stop_usd: {
    label: "Daily Loss — Tier 3: Stop Trading",
    hint: "When daily losses cross this (e.g. -$5,000), all trading is paused until manual review. The ultimate emergency brake. Auto-resets at UTC midnight along with the other tiers.",
  },
  speed_ngr_soft_block_stake_max_usd: {
    label: "Tier 2 — Reduced Per-Trade Maximum",
    hint: "When the Tier 2 soft-block is active, this becomes the per-trade stake cap regardless of the regular per-duration maximums. Default $100. Sets the throttled stake size during a bad day.",
  },
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
