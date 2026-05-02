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
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AdminPinSetup } from "./admin-pin-setup";

interface AdminCreditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillUser?: { id: string; display_name: string | null; phone: string | null; balance_usd: number } | null;
}

export function AdminCreditModal({ open, onOpenChange, prefillUser }: AdminCreditModalProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const [mode, setMode] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [hasPinChecked, setHasPinChecked] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  // User search state (when no prefillUser)
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; display_name: string | null; phone: string | null; balance_usd: number }>>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; display_name: string | null; phone: string | null; balance_usd: number } | null>(null);
  const [searching, setSearching] = useState(false);

  const targetUser = prefillUser || selectedUser;

  useEffect(() => {
    if (open && !hasPinChecked) {
      checkPin();
    }
  }, [open, hasPinChecked]);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setDescription("");
      setPin("");
      setMode("credit");
      if (!prefillUser) {
        setUserSearch("");
        setSearchResults([]);
        setSelectedUser(null);
      }
    }
  }, [open, prefillUser]);

  const checkPin = async () => {
    try {
      const res = await fetch("/api/admin/pin");
      if (!res.ok) {
        console.error("Failed to check admin PIN:", res.statusText);
        return;
      }
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

  const searchUsers = async (query: string) => {
    setUserSearch(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = (await res.json()) as { users: typeof searchResults };
        setSearchResults(data.users || []);
      } else {
        setSearchResults([]);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!targetUser) {
      toast.error(t("selectUserFirst"));
      return;
    }
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error(t("enterValidAmount"));
      return;
    }
    if (numAmount > 10000) {
      toast.error(t("amountExceedsMax"));
      return;
    }
    if (!pin) {
      toast.error(t("enterAdminPin"));
      return;
    }

    setLoading(true);
    try {
      const finalAmount = mode === "debit" ? -numAmount : numAmount;
      const res = await fetch("/api/admin/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUser.id,
          amount: finalAmount,
          description: description || `Admin ${mode}`,
          pin,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to adjust balance");
      }

      const data = (await res.json()) as { new_balance: number; type: string };
      toast.success(
        mode === "credit" ? t("creditApplied") : t("debitApplied"),
        {
          description: `${formatCurrency(numAmount)} ${mode === "credit" ? "to" : "from"} ${targetUser.display_name || targetUser.phone}. New balance: ${formatCurrency(data.new_balance ?? 0)}`,
        }
      );
      onOpenChange(false);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("failedToCredit");
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
              Admin Balance Adjustment
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              Credit or debit a user&apos;s balance. PIN required for authorization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Mode Toggle */}
            <div className="flex bg-[#f0f4f7] rounded-lg p-1">
              <button
                onClick={() => setMode("credit")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                  mode === "credit"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-[#566166] hover:text-[#2a3439]"
                }`}
              >
                <span className="material-symbols-outlined text-sm align-middle mr-1">add_circle</span>
                Credit
              </button>
              <button
                onClick={() => setMode("debit")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                  mode === "debit"
                    ? "bg-[var(--error)] text-white shadow-sm"
                    : "text-[#566166] hover:text-[#2a3439]"
                }`}
              >
                <span className="material-symbols-outlined text-sm align-middle mr-1">remove_circle</span>
                Debit
              </button>
            </div>

            {/* User Selection */}
            {prefillUser ? (
              <div className="bg-[#f0f4f7] rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#d5e3fc] flex items-center justify-center text-xs font-bold text-[#455367]">
                    {(prefillUser.display_name || "??").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#2a3439]">{prefillUser.display_name || prefillUser.phone}</p>
                    <p className="text-xs text-[#566166]">Balance: {formatCurrency(prefillUser.balance_usd)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">User</label>
                {selectedUser ? (
                  <div className="bg-[#f0f4f7] rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center text-[10px] font-bold text-[#455367]">
                        {(selectedUser.display_name || "??").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#2a3439]">{selectedUser.display_name || selectedUser.phone}</p>
                        <p className="text-xs text-[#566166]">Balance: {formatCurrency(selectedUser.balance_usd)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedUser(null); setUserSearch(""); }}
                      className="text-[#a9b4b9] hover:text-[#566166]"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={userSearch}
                      onChange={(e) => searchUsers(e.target.value)}
                      className="w-full bg-[#f0f4f7] border-none rounded-lg py-3 px-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      placeholder="Search by name or phone..."
                    />
                    {searching && (
                      <span className="absolute right-3 top-3 text-[#a9b4b9] text-sm">Searching...</span>
                    )}
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-lg border border-[#a9b4b9]/10 max-h-48 overflow-y-auto">
                        {searchResults.map((u) => (
                          <button
                            key={u.id}
                            onClick={() => { setSelectedUser(u); setSearchResults([]); setUserSearch(""); }}
                            className="w-full px-4 py-3 text-left hover:bg-[#f0f4f7] flex items-center gap-3 transition-colors"
                          >
                            <div className="w-7 h-7 rounded-full bg-[#d5e3fc] flex items-center justify-center text-[9px] font-bold text-[#455367]">
                              {(u.display_name || "??").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#2a3439]">{u.display_name || u.phone}</p>
                              <p className="text-xs text-[#a9b4b9]">{formatCurrency(u.balance_usd)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">Amount (USD)</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-[#717c82] font-bold">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  max="10000"
                  step="0.01"
                  className="w-full bg-[#f0f4f7] border-none rounded-lg py-3 pl-8 pr-4 text-sm font-bold tabular-nums focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[#f0f4f7] border-none rounded-lg py-3 px-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                placeholder={`Reason for ${mode}...`}
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

            {/* Confirmation banner */}
            {targetUser && amount && (
              <div className={`rounded-xl p-4 flex items-start gap-3 ${
                mode === "credit" ? "bg-emerald-50" : "bg-red-50"
              }`}>
                <span className={`material-symbols-outlined text-lg mt-0.5 ${
                  mode === "credit" ? "text-emerald-600" : "text-red-500"
                }`}>
                  {mode === "credit" ? "add_circle" : "remove_circle"}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${mode === "credit" ? "text-emerald-800" : "text-red-800"}`}>
                    {mode === "credit" ? "Credit" : "Debit"} {formatCurrency(parseFloat(amount) || 0)}
                    {mode === "credit" ? " to " : " from "}
                    {targetUser.display_name || targetUser.phone}
                  </p>
                  <p className={`text-xs mt-1 ${mode === "credit" ? "text-emerald-700" : "text-red-700"}`}>
                    Current balance: {formatCurrency(targetUser.balance_usd)}
                    {" → "}
                    {formatCurrency(
                      targetUser.balance_usd + (mode === "credit" ? 1 : -1) * (parseFloat(amount) || 0)
                    )}
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
              onClick={handleSubmit}
              disabled={loading || !targetUser || !amount || !pin}
              className={`px-6 py-2.5 font-bold rounded-lg transition-all text-sm disabled:opacity-50 flex items-center gap-2 ${
                mode === "credit"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-[var(--error)] text-white hover:opacity-90"
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {mode === "credit" ? "add_circle" : "remove_circle"}
              </span>
              {loading ? "Processing..." : mode === "credit" ? "Credit Balance" : "Debit Balance"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
