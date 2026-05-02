"use client";

/**
 * AdminAgentCreditModal — admin credit/debit of a user's COMMISSION wallet
 * (users.agent_balance_usd), not the trading wallet.
 *
 * Uses admin_adjust_agent_balance RPC (mig 298). PIN-protected, audited,
 * rejects frozen users and overdrafts. Mirrors the portfolio AdminCreditModal
 * pattern but targets the commission wallet explicitly so admin ops around
 * bug recovery / comp'ed commissions / disputes don't require raw SQL.
 */

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
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { AdminPinSetup } from "./admin-pin-setup";

interface AdminAgentCreditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    display_name: string | null;
    phone: string | null;
    agent_balance_usd: number;
  };
}

export function AdminAgentCreditModal({ open, onOpenChange, user }: AdminAgentCreditModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [hasPinChecked, setHasPinChecked] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    if (open && !hasPinChecked) {
      void checkPin();
    }
  }, [open, hasPinChecked]);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setDescription("");
      setPin("");
      setMode("credit");
    }
  }, [open]);

  const checkPin = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await supabase.rpc("admin_has_pin");
    setHasPin(!!data);
    setHasPinChecked(true);
    if (!data) setShowPinSetup(true);
  };

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (numAmount > 10000) {
      toast.error("Amount exceeds $10,000 cap");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (pin.length !== 6) {
      toast.error("Enter 6-digit admin PIN");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const finalAmount = mode === "debit" ? -numAmount : numAmount;
      const { data, error } = await supabase.rpc("admin_adjust_agent_balance", {
        p_user_id: user.id,
        p_amount: finalAmount,
        p_description: description,
        p_pin: pin,
      });

      if (error) throw error;

      const result = data as { new_agent_balance: number } | null;
      toast.success(mode === "credit" ? "Commission wallet credited" : "Commission wallet debited", {
        description: `${formatCurrency(numAmount)} ${mode === "credit" ? "to" : "from"} ${
          user.display_name || user.phone
        }. New balance: ${formatCurrency(result?.new_agent_balance ?? 0)}`,
      });
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to adjust agent wallet";
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
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
              Agent Wallet Adjustment
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              Credit or debit the commission wallet (agent_balance_usd). PIN required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Mode Toggle */}
            <div className="flex bg-[#f0f4f7] rounded-lg p-1">
              <button
                onClick={() => setMode("credit")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                  mode === "credit" ? "bg-indigo-600 text-white shadow-sm" : "text-[#566166]"
                }`}
              >
                Credit
              </button>
              <button
                onClick={() => setMode("debit")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                  mode === "debit" ? "bg-[var(--error)] text-white shadow-sm" : "text-[#566166]"
                }`}
              >
                Debit
              </button>
            </div>

            {/* User info */}
            <div className="bg-[#f0f4f7] rounded-xl p-4">
              <p className="text-sm font-bold text-[#2a3439]">{user.display_name || user.phone}</p>
              <p className="text-xs text-[#566166] mt-1">
                Commission wallet: {formatCurrency(user.agent_balance_usd)}
              </p>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">
                Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-[#717c82] font-bold">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  max="10000"
                  step="0.01"
                  className="w-full bg-[#f0f4f7] border-none rounded-lg py-3 pl-8 pr-4 text-sm font-bold tabular-nums focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[#f0f4f7] border-none rounded-lg py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                placeholder={`Reason for ${mode} (required, for audit)`}
              />
            </div>

            {/* PIN */}
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
                        const next = e.target.parentElement?.querySelector<HTMLInputElement>(
                          `input:nth-child(${i + 2})`
                        );
                        next?.focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !pin[i] && i > 0) {
                        const prev = (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>(
                          `input:nth-child(${i})`
                        );
                        prev?.focus();
                        const newPin = pin.split("");
                        newPin[i - 1] = "";
                        setPin(newPin.join(""));
                      }
                    }}
                    className="w-11 h-13 bg-[#f0f4f7] border-2 border-transparent rounded-xl text-center text-lg font-bold text-[#2a3439] font-mono focus:ring-0 focus:border-indigo-500 focus:outline-none transition-colors"
                  />
                ))}
              </div>
            </div>

            {/* Confirmation banner */}
            {amount && (
              <div
                className={`rounded-xl p-4 ${
                  mode === "credit" ? "bg-indigo-50" : "bg-red-50"
                }`}
              >
                <p className={`text-sm font-semibold ${mode === "credit" ? "text-indigo-800" : "text-red-800"}`}>
                  {mode === "credit" ? "Credit" : "Debit"} {formatCurrency(parseFloat(amount) || 0)}{" "}
                  {mode === "credit" ? "to" : "from"} commission wallet
                </p>
                <p className={`text-xs mt-1 ${mode === "credit" ? "text-indigo-700" : "text-red-700"}`}>
                  Current: {formatCurrency(user.agent_balance_usd)} →{" "}
                  {formatCurrency(
                    user.agent_balance_usd + (mode === "credit" ? 1 : -1) * (parseFloat(amount) || 0)
                  )}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-3 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !amount || !description || pin.length !== 6}
              className={`px-6 py-2.5 font-bold rounded-lg text-sm disabled:opacity-50 ${
                mode === "credit" ? "bg-indigo-600 text-white" : "bg-[var(--error)] text-white"
              }`}
            >
              {loading ? "Processing..." : mode === "credit" ? "Credit Wallet" : "Debit Wallet"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
