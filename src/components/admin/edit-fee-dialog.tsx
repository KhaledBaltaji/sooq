"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AdminPinSetup } from "./admin-pin-setup";

interface EditFeeDialogProps {
  // PK is fee_type — no `id` on fee_config in v1.
  fee: { fee_type: string; rate: number; description: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FeeFormat = "percentage" | "raw" | "multiplier" | "currency";

interface FeeConstraints {
  min: number;
  max: number;
  step: number;
  label: string;
  format: FeeFormat;
  warning?: string;
}

const FEE_CONSTRAINTS: Record<string, FeeConstraints> = {
  explicit_fee:              { min: 0, max: 0.05,    step: 0.001,  label: "Explicit Trading Fee", format: "percentage" },
  resolution_fee:            { min: 0, max: 0.05,    step: 0.001,  label: "Resolution Fee", format: "percentage" },
  cash_out_premium:          { min: 0, max: 0.05,    step: 0.001,  label: "Cash Out Fee", format: "percentage" },
  deposit_fee:               { min: 0, max: 0.05,    step: 0.001,  label: "Deposit Fee", format: "percentage" },
  withdrawal_fee:            { min: 0, max: 0.05,    step: 0.001,  label: "Withdrawal Fee", format: "percentage" },
  amm_default_b:             { min: 100, max: 100000, step: 100,   label: "AMM Liquidity Parameter (b)", format: "raw", warning: "Only affects newly created markets. Existing markets keep their current b value." },
  amm_max_trade_pct:         { min: 0.01, max: 0.20, step: 0.01,  label: "Max Trade Size (% of liquidity)", format: "percentage", warning: "Changes take effect on the next trade. Affects all open markets." },
  dynamic_spread_threshold:  { min: 0.50, max: 0.95, step: 0.01,  label: "Dynamic Spread Threshold", format: "percentage", warning: "Changes live trading behavior. Lower = spread widening triggers more often." },
  dynamic_spread_multiplier: { min: 1.0, max: 5.0,   step: 0.1,   label: "Dynamic Spread Multiplier", format: "multiplier", warning: "Changes live trading behavior. Higher = more aggressive spread widening when triggered." },

  // ── Speed master switches (read by speed_execute_trade/cashout per call) ──
  speed_markets_enabled:         { min: 0, max: 1,       step: 1,    label: "Speed Markets Enabled", format: "raw", warning: "Master kill switch. 0 = trade RPC rejects all new bets. Cashouts + resolution still run." },
  speed_cashout_enabled:         { min: 0, max: 1,       step: 1,    label: "Cashout Enabled", format: "raw", warning: "When 0, every cashout RPC call rejects. Use during oracle outages." },
  speed_oracle_stale_seconds:    { min: 1, max: 60,      step: 1,    label: "Oracle Stale Seconds", format: "raw", warning: "Trade RPC rejects when last oracle tick is older than this. Lower = stricter." },

  // ── Per-user / per-market caps ──
  speed_stake_max_5m_usd:        { min: 1, max: 10000000, step: 1, label: "Per-Bet Max — 5m markets (USD)", format: "currency", warning: "Single-bet ceiling for 5m duration. Server enforces." },
  speed_stake_max_1h_usd:        { min: 1, max: 10000000, step: 1, label: "Per-Bet Max — 1h markets (USD)", format: "currency", warning: "Single-bet ceiling for 1h duration." },
  speed_stake_max_usd:           { min: 1, max: 10000000, step: 1, label: "Per-Bet Max (legacy, USD)", format: "currency", warning: "Pre-mig-0027 single-bet cap. Use the per-duration keys instead." },
  speed_cap_per_side_usd:        { min: 1, max: 10000000, step: 10, label: "Per-Side Cap (USD)", format: "currency", warning: "Per-user, per-market, per-side stake cap. Resets every market cycle." },
  speed_per_user_per_market_cap_usd: { min: 1, max: 10000000, step: 10, label: "Per-User Per-Market Cap (USD)", format: "currency", warning: "Mig 0028 canonical name for the per-side cap." },

  // ── Pool-wide caps (mig 0028) ──
  speed_pool_collateral_usd:     { min: 1000, max: 10000000, step: 1000, label: "Pool Collateral (USD)", format: "currency", warning: "Notional pool size. Per-side cap and cluster cap are percentages of this." },
  speed_per_side_cap_pct:        { min: 0.01, max: 1.0, step: 0.01, label: "Per-Side Cap (% of pool)", format: "percentage", warning: "When stake on one side exceeds this fraction of pool, no more bets accepted." },
  speed_same_strike_cluster_cap_pct: { min: 0.01, max: 1.0, step: 0.01, label: "Same-Strike Cluster Cap (% of pool)", format: "percentage", warning: "Max exposure across markets sharing one strike. Catches correlated risk." },
  speed_daily_ngr_floor_usd:     { min: -1000000, max: 0, step: 100, label: "Daily NGR Floor (USD, negative)", format: "currency", warning: "Circuit breaker. When daily NGR crosses this (negative), new entries blocked. Auto-resets UTC midnight." },

  // ── Pricing engine v2 (mig 0028) ──
  speed_spread_pct:              { min: 0.01, max: 0.20, step: 0.005, label: "Base Spread", format: "percentage", warning: "Baked into offered_prob both sides. Default 0.05 = 5%." },
  speed_extreme_spread_coeff:    { min: 0, max: 100, step: 0.5, label: "Extreme Spread Coefficient", format: "raw", warning: "Quadratic widening beyond ±0.45 from 0.5 fair_prob." },
  speed_late_60s_spread_mult:    { min: 1.0, max: 5.0, step: 0.05, label: "Late 60s Spread Multiplier", format: "multiplier", warning: "Spread × this in last 60s of round. Default 1.4." },
  speed_late_30s_spread_mult:    { min: 1.0, max: 5.0, step: 0.05, label: "Late 30s Spread Multiplier", format: "multiplier", warning: "Spread × this in last 30s of round. Default 1.8." },
  speed_fair_prob_reject_high:   { min: 0.80, max: 0.999, step: 0.005, label: "Fair Prob Reject — High", format: "percentage", warning: "Reject entry when fair_prob_side > this. Replaces 0.99 saturation clamp. Default 0.97." },
  speed_fair_prob_reject_low:    { min: 0.001, max: 0.20, step: 0.005, label: "Fair Prob Reject — Low", format: "percentage", warning: "Reject entry when fair_prob_side < this. Default 0.03." },
  speed_late_30s_imbalance_reject: { min: 0.05, max: 0.50, step: 0.01, label: "Late 30s Imbalance Reject", format: "percentage", warning: "In last 30s, reject entry when |fair − 0.5| exceeds this. Closes deep-tail exploit. Default 0.30." },
  speed_cashout_late_30s_imbalance_reject: { min: 0.05, max: 0.50, step: 0.01, label: "Late 30s Cashout Imbalance Reject", format: "percentage", warning: "Mirror of entry-side defense for cashout." },
  speed_cashout_late_reject_s:   { min: 0, max: 60, step: 1, label: "Cashout Late Reject (seconds)", format: "raw", warning: "Reject cashouts when seconds remaining is below this. Default 10." },

  // ── Cashout option-C margins (mig 0028) ──
  speed_cashout_winning_base_5m: { min: 0, max: 0.20, step: 0.005, label: "Cashout Winning Base — 5m", format: "percentage", warning: "Margin extracted from winning side cashout, 5m. Default 2.5%." },
  speed_cashout_winning_base_1h: { min: 0, max: 0.20, step: 0.005, label: "Cashout Winning Base — 1h", format: "percentage", warning: "Margin extracted from winning side cashout, 1h. Default 3.0%." },
  speed_cashout_losing_base_5m:  { min: 0, max: 0.30, step: 0.005, label: "Cashout Losing Base — 5m", format: "percentage", warning: "Margin amplifying losing side cashout, 5m. Default 8.0%." },
  speed_cashout_losing_base_1h:  { min: 0, max: 0.30, step: 0.005, label: "Cashout Losing Base — 1h", format: "percentage", warning: "Margin amplifying losing side cashout, 1h. Default 9.0%." },
  speed_cashout_saturation_coef: { min: 0, max: 2.0, step: 0.05, label: "Saturation Coef (winning)", format: "raw", warning: "Premium added when |mark − 0.5| > 0.35 on winning side. Default 0.20." },
  speed_cashout_desperation_coef: { min: 0, max: 2.0, step: 0.05, label: "Desperation Coef (losing)", format: "raw", warning: "Premium added when mark < 0.5 on losing side. Default 0.40." },
  speed_cashout_late_window_winning_coef: { min: 0, max: 0.20, step: 0.005, label: "Late Window Coef — Winning", format: "raw", warning: "Margin ramp on winning side as time runs out. Default 0.015." },
  speed_cashout_late_window_losing_coef:  { min: 0, max: 0.50, step: 0.005, label: "Late Window Coef — Losing",  format: "raw", warning: "Margin ramp on losing side as time runs out. Default 0.05." },

  // ── IV / parity (mig 0029, 0030) ──
  speed_iv_btc:                  { min: 0.05, max: 5.0, step: 0.05, label: "IV Fallback (BTC)", format: "raw", warning: "Constant IV used when realized-vol cache is stale or empty." },
  speed_iv_drift_tolerance_pct:  { min: 0, max: 1.0, step: 0.01, label: "IV Drift Tolerance", format: "percentage", warning: "Stale-quote check. If client_iv drifts beyond this, reject with IV_DRIFT." },
  speed_iv_fail_closed:          { min: 0, max: 1, step: 1, label: "IV Fail-Closed Mode", format: "raw", warning: "When 1, reject trades if RV cache is stale (no fallback to constant IV). Operational gate." },
  speed_use_realized_vol:        { min: 0, max: 1, step: 1, label: "Use Realized Vol", format: "raw", warning: "Master switch. When 0, server bypasses RV cache and uses speed_iv_btc directly." },

  // ── Soft guards (mig 0031) ──
  speed_per_user_velocity_max:   { min: 1, max: 10000, step: 1, label: "Velocity Cap (bets/min)", format: "raw", warning: "Hard reject when user exceeds this many bets per rolling minute. Default 30." },
  speed_per_user_open_exposure_pct: { min: 0.01, max: 1.0, step: 0.01, label: "Open Exposure Cap (% of pool)", format: "percentage", warning: "Hard reject when user's total open liability exceeds this fraction of pool. Default 15%." },
  speed_per_user_daily_handle_alert: { min: 100, max: 10000000, step: 100, label: "Daily Handle Alert (USD)", format: "currency", warning: "Telemetry-only. Logs to speed_user_alerts when daily handle crosses this. No enforcement." },
};

const COMMISSION_CONSTRAINTS: FeeConstraints = {
  min: 0, max: 0.50, step: 0.01, label: "Commission Rate", format: "percentage",
  warning: "Changing commission rates affects agent earnings on all future trades.",
};

function getConstraints(feeType: string): FeeConstraints {
  if (FEE_CONSTRAINTS[feeType]) return FEE_CONSTRAINTS[feeType];
  if (feeType.includes("commission")) return COMMISSION_CONSTRAINTS;
  return { min: 0, max: 1, step: 0.001, label: "Fee Rate", format: "percentage" };
}

function formatValue(value: number, format: FeeFormat): string {
  if (format === "raw") return String(value);
  if (format === "multiplier") return `${value}x`;
  if (format === "currency") {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatInputHint(format: FeeFormat): string {
  if (format === "raw") return "Enter the raw value (e.g. 1000)";
  if (format === "multiplier") return "Enter the multiplier (e.g. 1.5 = 1.5x)";
  if (format === "currency") return "Enter the dollar amount (e.g. 1000000 = $1,000,000)";
  return "Enter as decimal (e.g. 0.005 = 0.5%)";
}

export function EditFeeDialog({ fee, open, onOpenChange }: EditFeeDialogProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const constraints = getConstraints(fee.fee_type);
  const [rate, setRate] = useState(String(fee.rate));
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(!constraints.warning);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [hasPinChecked, setHasPinChecked] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  const parsed = parseFloat(rate);
  const isValid = !isNaN(parsed) && parsed >= constraints.min && parsed <= constraints.max;
  const hasChanged = parsed !== fee.rate;

  useEffect(() => {
    if (open && !hasPinChecked) {
      checkPin();
    }
  }, [open, hasPinChecked]);

  useEffect(() => {
    if (!open) {
      setPin("");
      setRate(String(fee.rate));
      setConfirmed(!constraints.warning);
    }
  }, [open, fee.rate, constraints.warning]);

  const checkPin = async () => {
    try {
      const res = await fetch("/api/admin/pin");
      if (!res.ok) return;
      const data = (await res.json()) as { has_pin: boolean };
      setHasPin(data.has_pin);
      setHasPinChecked(true);
      if (!data.has_pin) {
        setShowPinSetup(true);
      }
    } catch (err) {
      console.error("Failed to check admin PIN:", err);
    }
  };

  const handleSave = async () => {
    if (!isValid) {
      toast.error(t("valueOutOfRange", { min: constraints.min, max: constraints.max }));
      return;
    }
    if (constraints.warning && !confirmed) {
      toast.error(t("confirmFeeChange"));
      return;
    }
    if (!pin) {
      toast.error(t("enterAdminPin"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/fees/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_type: fee.fee_type, rate: parsed, pin }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to update fee");
      }

      toast.success(
        t("feeUpdated", {
          feeType: fee.fee_type,
          oldValue: formatValue(fee.rate, constraints.format),
          newValue: formatValue(parsed, constraints.format),
        })
      );
      onOpenChange(false);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update fee";
      toast.error(message);
    } finally {
      setLoading(false);
      setPin("");
    }
  };

  return (
    <>
      <AdminPinSetup
        open={showPinSetup}
        onOpenChange={setShowPinSetup}
        onSuccess={() => {
          setHasPin(true);
          setShowPinSetup(false);
        }}
      />

      <Dialog open={open && hasPin} onOpenChange={onOpenChange}>
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
              Edit {constraints.label}
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              {fee.description || fee.fee_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2 block">
                Current Value
              </label>
              <p className="text-2xl font-bold font-[family-name:var(--font-manrope)] text-[#2a3439] tabular-nums">
                {formatValue(fee.rate, constraints.format)}
              </p>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2 block">
                New Value
              </label>
              <p className="text-[10px] text-[#566166] mb-1.5">{formatInputHint(constraints.format)}</p>
              <input
                type="number"
                step={constraints.step}
                min={constraints.min}
                max={constraints.max}
                value={rate}
                onChange={(e) => { setRate(e.target.value); setConfirmed(!constraints.warning); }}
                className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all tabular-nums font-mono"
              />
              {rate && !isNaN(parsed) && (
                <p className="text-xs text-[#566166] mt-1.5">
                  = <span className={`font-bold ${isValid ? "text-[var(--yes)]" : "text-red-500"}`}>
                    {formatValue(parsed, constraints.format)}
                  </span>
                  {!isValid && (
                    <span className="text-red-500 ml-2">
                      (must be {constraints.min}–{constraints.max})
                    </span>
                  )}
                </p>
              )}
            </div>

            {constraints.warning && hasChanged && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-amber-600 text-lg mt-0.5">warning</span>
                  <div>
                    <p className="text-xs text-amber-800">{constraints.warning}</p>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-xs font-semibold text-amber-800">I understand the impact</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* PIN Input */}
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">Admin PIN</label>
              <div className="flex gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <input
                    key={i}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={pin[i] || ""}
                    onChange={(e) => {
                      const char = e.target.value;
                      if (!/^\d*$/.test(char)) return;
                      const newPin = pin.split("");
                      newPin[i] = char;
                      setPin(newPin.join("").slice(0, 6));
                      if (char && i < 5) {
                        const next = e.target.parentElement?.querySelector<HTMLInputElement>(`input:nth-child(${i + 2})`);
                        next?.focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !pin[i] && i > 0) {
                        const prev = (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>(`input:nth-child(${i})`);
                        prev?.focus();
                        const newPin = pin.split("");
                        newPin[i - 1] = "";
                        setPin(newPin.join(""));
                      }
                    }}
                    className="w-11 h-13 bg-[#f0f4f7] border-2 border-transparent rounded-xl text-center text-lg font-bold text-[#2a3439] font-mono focus:ring-0 focus:border-[var(--yes)] focus:outline-none transition-colors"
                  />
                ))}
              </div>
            </div>

            {/* Change preview */}
            {hasChanged && isValid && (
              <div className="bg-blue-50 rounded-xl p-4 flex items-start gap-3">
                <span className="material-symbols-outlined text-lg mt-0.5 text-blue-600">swap_horiz</span>
                <div>
                  <p className="text-sm font-semibold text-blue-800">
                    {formatValue(fee.rate, constraints.format)} → {formatValue(parsed, constraints.format)}
                  </p>
                  <p className="text-xs mt-1 text-blue-700">
                    This change will be logged in the audit trail.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-3 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || !isValid || !hasChanged || !pin || (!!constraints.warning && !confirmed)}
              className="px-6 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
