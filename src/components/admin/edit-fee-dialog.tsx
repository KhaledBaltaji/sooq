"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
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
  fee: { id: string; fee_type: string; rate: number; description: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FeeConstraints {
  min: number;
  max: number;
  step: number;
  label: string;
  format: "percentage" | "raw" | "multiplier";
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

function formatValue(value: number, format: "percentage" | "raw" | "multiplier"): string {
  if (format === "raw") return String(value);
  if (format === "multiplier") return `${value}x`;
  return `${(value * 100).toFixed(2)}%`;
}

function formatInputHint(format: "percentage" | "raw" | "multiplier"): string {
  if (format === "raw") return "Enter the raw value (e.g. 1000)";
  if (format === "multiplier") return "Enter the multiplier (e.g. 1.5 = 1.5x)";
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
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await supabase.rpc("admin_has_pin");
    if (error) {
      console.error("Failed to check admin PIN:", error.message);
      return;
    }
    setHasPin(!!data);
    setHasPinChecked(true);
    if (!data) {
      setShowPinSetup(true);
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
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data, error } = await supabase.rpc("admin_update_fee", {
        p_fee_id: fee.id,
        p_new_rate: parsed,
        p_pin: pin,
      });

      if (error) throw error;

      const result = data as { old_rate: number; new_rate: number } | null;
      toast.success(
        t("feeUpdated", {
          feeType: fee.fee_type,
          oldValue: formatValue(result?.old_rate ?? fee.rate, constraints.format),
          newValue: formatValue(result?.new_rate ?? parsed, constraints.format),
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
