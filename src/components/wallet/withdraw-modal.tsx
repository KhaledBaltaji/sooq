"use client";

import { useState, useEffect } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useBalance } from "@/hooks/use-balance";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MIN_WITHDRAWAL } from "@/lib/constants";
import { formatCurrency, cn } from "@/lib/utils";
import { X, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

// At launch we support two withdrawal rails:
//   - whish:  Lebanese mobile payment — user enters their Whish phone number,
//             balance is deducted immediately, ops sends manually after admin approval
//   - crypto: USDT on Tron (TRC20) — user enters their USDT TRC20 wallet address,
//             balance is deducted immediately, 3pay (or manual ops) sends after approval
// Bank withdrawals and USDT ERC20 are intentionally disabled (see migration 288).
type DestinationType = "whish" | "crypto";

const DESTINATION_KEYS: Record<DestinationType, string> = {
  whish: "whishWallet",
  crypto: "cryptoWallet",
};

// Client-side format validation — kept loose; the RPC re-validates strictly.
const TRC20_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const PHONE_REGEX = /^\+?[0-9]{8,15}$/;

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
}

export function WithdrawModal({ open, onClose }: WithdrawModalProps) {
  const supabase = useSupabase();
  const { balance } = useBalance();
  const t = useTranslations("wallet");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const [amount, setAmount] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("whish");
  const [destination, setDestination] = useState("");
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feeRate, setFeeRate] = useState(0.01);
  const [status, setStatus] = useState<"idle" | "confirmed">("idle");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Fetch fee rate
  useEffect(() => {
    if (!open) return;
    supabase
      .from("fee_config")
      .select("rate")
      .eq("fee_type", "withdrawal_fee")
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to fetch withdrawal fee rate:", error.message);
          return;
        }
        if (data) setFeeRate(data.rate);
      });
  }, [open, supabase]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setAmount("");
        setDestinationType("whish");
        setDestination("");
        setShowTypeDropdown(false);
        setLoading(false);
        setStatus("idle");
        setValidationError(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset destination when type changes (phone vs wallet address have different formats)
  useEffect(() => {
    setDestination("");
    setValidationError(null);
  }, [destinationType]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const numAmount = parseFloat(amount) || 0;
  const fee = numAmount * feeRate;
  const netAmount = numAmount - fee;
  const selectedTypeLabel = t(DESTINATION_KEYS[destinationType]);

  const handleMax = () => {
    setAmount(balance.toFixed(2));
  };

  const validateDestination = (): string | null => {
    const trimmed = destination.trim();
    if (!trimmed) return t("destinationRequired");
    if (destinationType === "crypto") {
      if (!TRC20_REGEX.test(trimmed)) return t("invalidTrc20Address");
    } else {
      if (!PHONE_REGEX.test(trimmed)) return t("invalidPhone");
    }
    return null;
  };

  const handleWithdraw = async () => {
    const err = validateDestination();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    setLoading(true);
    const { error } = await supabase.rpc("process_withdrawal" as never, {
      p_amount: numAmount,
      p_destination: destination.trim(),
      p_currency: destinationType === "crypto" ? "USDT" : "USD",
      p_destination_type: destinationType,
      p_network: destinationType === "crypto" ? "TRC20" : null,
    } as never);

    if (error) {
      toast.error(error.message);
      setLoading(false);
    } else {
      toast.success(tToast("withdrawalSubmitted"));
      setStatus("confirmed");
      setLoading(false);
    }
  };

  const destinationPlaceholder = destinationType === "crypto"
    ? t("trc20AddressPlaceholder")
    : t("phonePlaceholder");

  const destinationLabel = destinationType === "crypto"
    ? t("walletAddress")
    : t("whishPhoneNumber");

  const canSubmit = numAmount >= MIN_WITHDRAWAL
    && numAmount <= balance
    && destination.trim().length > 0
    && !loading;

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 min-h-[100dvh] flex items-center justify-center p-6">
        <div
          className={cn(
            "w-full max-w-[520px]",
            "animate-in fade-in zoom-in-95 duration-200"
          )}
        >
          <div className="bg-surface rounded-2xl p-10 shadow-[0_8px_32px_rgba(0,0,0,0.25)] relative overflow-hidden">
            <button
              onClick={onClose}
              className="absolute top-6 right-6 text-muted-custom hover:text-text transition-colors w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full hover:bg-elevated/50 z-10"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {status === "confirmed" ? (
              <div className="text-center py-12 space-y-4 animate-in fade-in duration-200">
                <div className="w-16 h-16 mx-auto bg-success/10 rounded-full flex items-center justify-center">
                  <Check className="w-8 h-8 text-success" />
                </div>
                <p className="text-text font-satoshi font-bold text-xl">
                  {t("withdrawalSubmitted")}
                </p>
                <p className="text-muted-custom text-sm font-dm-sans">
                  {t("willBeSent", { amount: formatCurrency(netAmount) })}
                </p>
                <Button onClick={onClose} className="bg-yes hover:bg-yes/90 text-white h-12 px-8">
                  {tc("done")}
                </Button>
              </div>
            ) : (
              <div>
                <h2 className="text-[28px] font-medium text-text font-satoshi mb-2">
                  {t("withdraw")}
                </h2>
                <p className="text-sm text-muted-custom mb-8">
                  {t("available", { amount: formatCurrency(balance) })}
                </p>

                {/* Amount input */}
                <div className="mb-4">
                  <label className="block text-sm text-muted-custom font-dm-sans mb-2">
                    {t("amountToWithdraw")}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min={MIN_WITHDRAWAL}
                      max={balance}
                      className="w-full h-14 bg-bg border border-border-custom rounded-xl px-4 pe-28 text-text font-satoshi font-bold text-lg placeholder:text-muted-custom/50 focus:outline-none focus:border-yes focus:ring-1 focus:ring-yes/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <button
                        onClick={handleMax}
                        className="text-xs font-dm-sans font-bold text-muted-custom hover:text-yes transition-colors uppercase tracking-wider"
                      >
                        {t("max")}
                      </button>
                      <span className="text-muted-custom text-xs font-dm-sans font-semibold uppercase">USD</span>
                    </div>
                  </div>
                </div>

                {/* Destination type dropdown */}
                <div className="mb-4 relative">
                  <label className="block text-sm text-muted-custom font-dm-sans mb-2">
                    {t("selectDestination")}
                  </label>
                  <button
                    onClick={() => setShowTypeDropdown(!showTypeDropdown)}
                    className="w-full h-14 bg-bg border border-border-custom rounded-xl px-4 flex items-center justify-between text-text font-dm-sans text-sm hover:border-yes/50 transition-all"
                  >
                    <span>{selectedTypeLabel}</span>
                    <ChevronDown className={cn(
                      "w-5 h-5 text-muted-custom transition-transform",
                      showTypeDropdown && "rotate-180"
                    )} />
                  </button>

                  {showTypeDropdown && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-border-custom rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                      {(["whish", "crypto"] as DestinationType[]).map((d) => (
                        <button
                          key={d}
                          onClick={() => {
                            setDestinationType(d);
                            setShowTypeDropdown(false);
                          }}
                          className={cn(
                            "w-full px-4 py-3.5 text-left text-sm font-dm-sans transition-colors",
                            destinationType === d
                              ? "bg-yes/10 text-yes font-medium"
                              : "text-text hover:bg-elevated"
                          )}
                        >
                          {t(DESTINATION_KEYS[d])}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Destination input (phone or TRC20 address) */}
                <div className="mb-4">
                  <label className="block text-sm text-muted-custom font-dm-sans mb-2">
                    {destinationLabel}
                  </label>
                  <input
                    type="text"
                    placeholder={destinationPlaceholder}
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      if (validationError) setValidationError(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      "w-full h-14 bg-bg border rounded-xl px-4 text-text font-dm-sans text-sm placeholder:text-muted-custom/50 focus:outline-none focus:ring-1 transition-all",
                      validationError
                        ? "border-danger focus:border-danger focus:ring-danger/30"
                        : "border-border-custom focus:border-yes focus:ring-yes/30"
                    )}
                  />
                  {validationError && (
                    <p className="mt-1.5 text-xs text-danger font-dm-sans">{validationError}</p>
                  )}
                </div>

                {/* Fee */}
                <div className="flex justify-between items-center mb-8 px-1">
                  <span className="text-sm text-muted-custom font-dm-sans">{t("withdrawalFee", { rate: (feeRate * 100).toFixed(1) })}</span>
                  <span className="text-sm text-text font-dm-sans font-medium">{formatCurrency(fee)}</span>
                </div>

                <Button
                  onClick={handleWithdraw}
                  disabled={!canSubmit}
                  className="w-full h-14 bg-yes hover:bg-yes/90 text-white font-dm-sans font-semibold text-base rounded-xl"
                >
                  {loading ? t("processing") : t("withdrawFundsBtn")}
                </Button>

                <p className="text-center text-xs text-muted-custom font-dm-sans mt-6 leading-relaxed">
                  {t("withdrawalInfo")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
