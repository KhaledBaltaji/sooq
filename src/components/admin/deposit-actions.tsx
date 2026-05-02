"use client";

import { useState } from "react";
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
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DepositActionsProps {
  deposit: {
    id: string;
    amount: number;
    net_amount: number;
    user_name: string;
    status: string;
  };
}

export function DepositActions({ deposit }: DepositActionsProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [loading, setLoading] = useState(false);
  const [approveAmount, setApproveAmount] = useState("");
  const [pin, setPin] = useState("");

  if (deposit.status !== "pending_review") return null;

  const parsedAmount = parseFloat(approveAmount) || 0;

  const resetDialog = () => {
    setAction(null);
    setApproveAmount("");
    setPin("");
  };

  const handleConfirm = async () => {
    if (action === "approve" && parsedAmount <= 0) return;
    if (pin.length !== 6) return;
    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { error } = await supabase.rpc(
        "admin_review_deposit" as never,
        {
          p_deposit_id: deposit.id,
          p_action: action,
          p_pin: pin,
          ...(action === "approve" ? { p_amount: parsedAmount } : {}),
        } as never
      );

      if (error) throw error;

      toast.success(
        action === "approve"
          ? t("depositApproved", { amount: formatCurrency(parsedAmount) })
          : t("depositRejected")
      );
      resetDialog();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("failedToProcess");
      toast.error(message);
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setAction("approve")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 transition-all"
        >
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          Approve
        </button>
        <button
          onClick={() => setAction("reject")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 transition-all"
        >
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
          Reject
        </button>
      </div>

      <Dialog open={!!action} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
              {action === "approve" ? "Approve" : "Reject"} Deposit
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              {action === "approve"
                ? `Approve manual deposit for ${deposit.user_name}?`
                : `Reject deposit request from ${deposit.user_name}?`}
            </DialogDescription>
          </DialogHeader>

          {action === "approve" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-[#2a3439]">
                Deposit Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#566166] font-semibold">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={approveAmount}
                  onChange={(e) => setApproveAmount(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 rounded-xl border-2 border-gray-200 focus:border-emerald-400 focus:outline-none text-lg font-semibold text-[#2a3439] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  autoFocus
                />
              </div>
            </div>
          )}

          <div className={`rounded-xl p-4 flex items-start gap-3 ${
            action === "approve" ? "bg-emerald-50" : "bg-red-50"
          }`}>
            <span className={`material-symbols-outlined text-lg mt-0.5 ${
              action === "approve" ? "text-emerald-600" : "text-red-500"
            }`}>
              {action === "approve" ? "info" : "warning"}
            </span>
            <div>
              <p className={`text-sm font-semibold ${action === "approve" ? "text-emerald-800" : "text-red-800"}`}>
                {action === "approve" ? "Funds will be credited" : "Deposit will be declined"}
              </p>
              <p className={`text-xs mt-1 ${action === "approve" ? "text-emerald-700" : "text-red-700"}`}>
                {action === "approve"
                  ? "The user's balance will be credited with the net deposit amount after fees."
                  : "The deposit will be marked as rejected. No funds were held, so no refund is needed."}
              </p>
            </div>
          </div>

          {/* Admin PIN — required for defense-in-depth on financial actions */}
          <div className="pt-2">
            <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">Admin PIN</label>
            <div className="flex gap-2 justify-center">
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

          <DialogFooter className="gap-3 pt-2">
            <button
              onClick={resetDialog}
              disabled={loading}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                loading
                || pin.length !== 6
                || (action === "approve" && parsedAmount <= 0)
              }
              className={`px-6 py-2.5 font-bold rounded-lg transition-all text-sm disabled:opacity-50 flex items-center gap-2 ${
                action === "approve"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-[var(--error)] text-white hover:opacity-90"
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {action === "approve" ? "check" : "close"}
              </span>
              {loading ? "Processing..." : action === "approve" ? "Approve" : "Reject"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
