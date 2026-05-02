"use client";

import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MIN_DEPOSIT } from "@/lib/constants";
import { formatCurrency, cn } from "@/lib/utils";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import Image from "next/image";
import { ArrowLeft, X, ChevronRight, Info, Lock, ShieldCheck, Copy, Check, Loader2 } from "lucide-react";
import { WhishManualForm } from "@/components/wallet/whish-manual-form";

type Provider = "trc20" | "erc20" | "whish" | "whish_manual";
type Step = "method" | "crypto" | "amount" | "whish_manual";
type Direction = "forward" | "back";
type Network = "TRC20" | "ERC20";

const AMOUNT_PRESETS = [20, 50, 100];

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

export function DepositModal({ open, onClose }: DepositModalProps) {
  const [step, setStep] = useState<Step>("method");
  const [direction, setDirection] = useState<Direction>("forward");
  // Default to whish_manual since USDT TRC20/ERC20 are hidden from the UI
  // until the 3pay merchant integration is live.
  const [provider, setProvider] = useState<Provider>("whish_manual");
  const [amount, setAmount] = useState<number>(0);
  const [network, setNetwork] = useState<Network>("TRC20");
  const [status, setStatus] = useState<"idle" | "waiting" | "confirmed">("idle");

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep("method");
        setDirection("forward");
        setProvider("whish_manual");
        setAmount(0);
        setNetwork("TRC20");
        setStatus("idle");
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

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

  const goTo = (next: Step, dir: Direction = "forward") => {
    setDirection(dir);
    setStep(next);
  };

  const selectProvider = (p: Provider) => {
    setProvider(p);
    if (p === "trc20") {
      setNetwork("TRC20");
      goTo("crypto", "forward");
    } else if (p === "erc20") {
      setNetwork("ERC20");
      goTo("crypto", "forward");
    } else if (p === "whish_manual") {
      goTo("whish_manual", "forward");
    } else {
      goTo("amount", "forward");
    }
  };

  const handleDeposit = () => {
    setStatus("waiting");
  };

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card container */}
      <div className="relative z-10 min-h-[100dvh] flex items-center justify-center p-6">
        <div
          className={cn(
            "w-full max-w-[520px]",
            "animate-in fade-in zoom-in-95 duration-200"
          )}
        >
          <div className="bg-surface rounded-2xl p-10 shadow-[0_8px_32px_rgba(0,0,0,0.25)] relative overflow-hidden">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-6 right-6 text-muted-custom hover:text-text transition-colors w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full hover:bg-elevated/50 z-10"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Steps */}
            <div className="relative">
              <StepWrapper active={step === "method"} direction={direction}>
                <MethodStep onSelect={selectProvider} />
              </StepWrapper>

              <StepWrapper active={step === "crypto"} direction={direction}>
                <CryptoStep
                  network={network}
                  onBack={() => goTo("method", "back")}
                  onDepositDetected={() => setStatus("confirmed")}
                />
              </StepWrapper>

              <StepWrapper active={step === "amount"} direction={direction}>
                <AmountStep
                  provider={provider}
                  amount={amount}
                  status={status}
                  onAmountChange={setAmount}
                  onBack={() => goTo("method", "back")}
                  onDeposit={handleDeposit}
                  onClose={onClose}
                />
              </StepWrapper>

              <StepWrapper active={step === "whish_manual"} direction={direction}>
                <WhishManualForm
                  compact
                  onBack={() => goTo("method", "back")}
                  onSuccess={onClose}
                />
              </StepWrapper>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Step animation wrapper ---
function StepWrapper({ active, direction, children }: { active: boolean; direction: Direction; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <div
      className={cn(
        "animate-in duration-200 ease-out fill-mode-both",
        direction === "forward"
          ? "fade-in slide-in-from-right-4"
          : "fade-in slide-in-from-left-4"
      )}
    >
      {children}
    </div>
  );
}

// --- Step 1: Select Method ---
function MethodStep({ onSelect }: {
  onSelect: (p: Provider) => void;
}) {
  const t = useTranslations("wallet");
  return (
    <div>
      <h2 className="text-[28px] font-medium text-text font-satoshi mb-2">
        {t("deposit")}
      </h2>
      <p className="text-sm text-muted-custom mb-8">
        {t("selectDepositMethod")}
      </p>

      <div className="space-y-3">
        {/* Launch scope: USDT TRC20 + Whish Manual only.
            ERC20 intentionally hidden (gas fees make small deposits uneconomical). */}
        <MethodCard
          icon={<Image src="/icons/usdt-trc20.png" alt="USDT TRC20" width={32} height={32} />}
          title={t("usdtTrc20")}
          subtitle={t("usdtTrc20Desc")}
          onClick={() => onSelect("trc20")}
        />
        <MethodCard
          icon={<Image src="/icons/whish.png" alt="Whish Auto" width={32} height={32} className="rounded-lg" />}
          title={t("whishAuto")}
          subtitle={t("whishAutoDesc")}
          disabled
          badge={t("comingSoon")}
          tag={t("whishAutoTag")}
        />
        <MethodCard
          icon={<Image src="/icons/whish.png" alt="Whish Manual" width={32} height={32} className="rounded-lg" />}
          title={t("whishManual")}
          subtitle={t("whishManualDesc")}
          onClick={() => onSelect("whish_manual")}
          tag={t("whishManualTag")}
        />
      </div>

      {/* Info text */}
      <div className="flex items-center gap-2.5 mt-8 justify-center">
        <Info className="w-4 h-4 text-muted-custom flex-shrink-0" />
        <p className="text-muted-custom text-sm font-dm-sans">
          {t("fundsAvailable")}
        </p>
      </div>

      {/* Security badges */}
      <div className="flex items-center justify-center gap-8 mt-6 pt-6 border-t border-border-custom">
        <div className="flex items-center gap-2 text-muted-custom">
          <Lock className="w-4 h-4" />
          <span className="text-xs font-dm-sans font-semibold uppercase tracking-wider">{t("secured")}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-custom">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-xs font-dm-sans font-semibold uppercase tracking-wider">{t("pciCompliant")}</span>
        </div>
      </div>
    </div>
  );
}

// --- Method card row ---
function MethodCard({ icon, title, subtitle, onClick, disabled, badge, tag }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
  tag?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-4 p-5 bg-bg border border-border-custom rounded-xl transition-all group",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-yes/50 active:scale-[0.98]"
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-elevated flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="text-left flex-1">
        <div className="flex items-center gap-2">
          <p className="text-text font-dm-sans font-semibold text-[15px]">{title}</p>
          {tag && (
            <span className="text-[9px] font-dm-sans font-bold uppercase tracking-wider text-yes bg-yes/10 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          )}
          {badge && (
            <span className="text-[10px] font-dm-sans font-semibold uppercase tracking-wider text-muted-custom bg-elevated px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        <p className="text-muted-custom text-sm">{subtitle}</p>
      </div>
      {!disabled && (
        <ChevronRight className="w-5 h-5 text-muted-custom group-hover:text-text transition-colors flex-shrink-0" />
      )}
    </button>
  );
}

// --- Step 2: Crypto Deposit (Real 3pay wallet) ---
function CryptoStep({ network, onBack, onDepositDetected }: {
  network: Network;
  onBack: () => void;
  onDepositDetected: () => void;
}) {
  const supabase = useSupabase();
  const { user } = useSession();
  const t = useTranslations("wallet");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<{ trc20: string | null; erc20: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch or generate wallet addresses
  useEffect(() => {
    let cancelled = false;
    async function fetchWallet() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/wallet/generate", { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to generate wallet");
        }
        const data = await res.json();
        if (!cancelled) {
          setWalletAddresses({ trc20: data.trc20, erc20: data.erc20 });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load wallet");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchWallet();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to deposits table for real-time deposit detection
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("deposit-watch")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deposits",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new.status === "confirmed" && payload.new.provider === "3pay") {
            onDepositDetected();
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Deposit watch realtime subscription error");
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user, onDepositDetected]);

  const address = network === "TRC20" ? walletAddresses?.trc20 : walletAddresses?.erc20;

  const handleCopy = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  return (
    <div className="relative">
      {/* Back button */}
      <button
        onClick={onBack}
        className="absolute top-0 left-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="pt-1 ps-12 mb-8">
        <div className="flex items-center gap-3">
          <Image
            src={network === "TRC20" ? "/icons/usdt-trc20.png" : "/icons/usdt-erc20.png"}
            alt={`USDT ${network}`}
            width={36}
            height={36}
          />
          <div>
            <h2 className="text-[24px] font-medium text-text font-satoshi leading-tight">
              USDT {network}
            </h2>
            <p className="text-sm text-muted-custom">
              {t("sendUsdtBelow")}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <Loader2 className="w-8 h-8 text-yes animate-spin" />
          <p className="text-muted-custom text-sm font-dm-sans">{t("generatingWallet")}</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 space-y-4">
          <p className="text-danger text-sm font-dm-sans">{error}</p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            className="text-sm"
          >
            {tc("retry")}
          </Button>
        </div>
      ) : (
        <>
          {/* QR Code */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-48 h-48 bg-white rounded-2xl flex items-center justify-center mb-4 border-2 border-border-custom p-3">
              {address ? (
                <QRCodeSVG
                  value={address}
                  size={168}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              ) : (
                <p className="text-muted-custom text-xs text-center font-dm-sans">
                  {t("noAddressAvailable", { network })}
                </p>
              )}
            </div>
          </div>

          {/* Wallet address */}
          {address && (
            <div className="mb-6">
              <p className="text-xs text-muted-custom font-dm-sans uppercase tracking-wider mb-2 font-medium">
                {network === "TRC20" ? t("tronAddress") : t("ethereumAddress")}
              </p>
              <div className="flex items-center gap-2 bg-bg border border-border-custom rounded-xl p-4">
                <p className="text-text text-sm font-mono flex-1 truncate">
                  {address}
                </p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-yes hover:text-yes/80 transition-colors flex-shrink-0 text-sm font-dm-sans font-medium"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      {t("copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      {tc("copy")}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Warning */}
      <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
        <p className="text-warning text-xs font-dm-sans leading-relaxed">
          {t("cryptoWarning", { token: "USDT", network: network === "TRC20" ? "TRON (TRC20)" : "Ethereum (ERC20)" })}
        </p>
      </div>
    </div>
  );
}

// --- Step 3: Select Amount (for Bank/Card/Whish) ---
function AmountStep({ provider, amount, status, onAmountChange, onBack, onDeposit, onClose }: {
  provider: Provider;
  amount: number;
  status: "idle" | "waiting" | "confirmed";
  onAmountChange: (n: number) => void;
  onBack: () => void;
  onDeposit: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("wallet");
  const tc = useTranslations("common");
  const [customAmount, setCustomAmount] = useState("");
  const providerLabel = t("whish");

  if (status === "waiting") {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="w-14 h-14 mx-auto border-2 border-yes border-t-transparent rounded-full animate-spin" />
        <p className="text-text font-dm-sans text-lg font-medium">
          {t("processingDeposit")}
        </p>
        <p className="text-muted-custom text-sm">
          {t("completing", { amount: formatCurrency(amount), provider: providerLabel })}
        </p>
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="w-16 h-16 mx-auto bg-success/10 rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-success" />
        </div>
        <p className="text-text font-satoshi font-bold text-xl">
          {t("deposited", { amount: formatCurrency(amount) })}
        </p>
        <Button onClick={onClose} className="bg-yes hover:bg-yes/90 text-white h-12 px-8">
          {tc("done")}
        </Button>
      </div>
    );
  }

  const isPreset = AMOUNT_PRESETS.includes(amount);

  return (
    <div className="relative">
      {/* Back button */}
      <button
        onClick={onBack}
        className="absolute top-0 left-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="pt-1 ps-12 mb-8">
        <h2 className="text-[24px] font-medium text-text font-satoshi">
          {t("selectAmount")}
        </h2>
        <p className="text-sm text-muted-custom">
          {t("via", { provider: providerLabel })}
        </p>
      </div>

      {/* Amount presets + custom input */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {AMOUNT_PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              onAmountChange(preset);
              setCustomAmount("");
            }}
            className={cn(
              "py-5 rounded-xl text-center font-satoshi font-bold text-lg transition-all",
              amount === preset && isPreset
                ? "bg-yes/10 text-yes border-2 border-yes"
                : "bg-bg border-2 border-elevated text-text hover:border-yes/50"
            )}
          >
            {formatCurrency(preset)}
          </button>
        ))}

        {/* Custom amount input */}
        <div
          className={cn(
            "relative rounded-xl border-2 transition-all flex items-center",
            !isPreset && amount > 0
              ? "border-yes bg-yes/10"
              : "border-elevated bg-bg hover:border-yes/50"
          )}
        >
          <span className={cn(
            "absolute left-4 font-satoshi font-bold text-lg",
            !isPreset && amount > 0 ? "text-yes" : "text-muted-custom"
          )}>
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder={t("other")}
            value={customAmount}
            onChange={(e) => {
              const val = e.target.value;
              setCustomAmount(val);
              const num = parseFloat(val) || 0;
              onAmountChange(num);
            }}
            className="w-full h-full py-5 ps-9 pe-4 bg-transparent text-center font-satoshi font-bold text-lg text-text placeholder:text-muted-custom placeholder:font-medium focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      <Button
        onClick={onDeposit}
        disabled={amount < MIN_DEPOSIT}
        className="w-full h-14 bg-yes hover:bg-yes/90 text-white font-dm-sans font-semibold text-base rounded-xl"
      >
        {amount > 0 ? t("depositVia", { amount: formatCurrency(amount), provider: providerLabel }) : t("deposit")}
      </Button>
    </div>
  );
}
