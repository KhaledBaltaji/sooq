"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate as fmAnimate } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronDown, Info } from "lucide-react";
import { cn, formatCurrency, formatNumber, triggerHapticConfirm } from "@/lib/utils";
import { speedFairProbOver, speedOfferedProb } from "@/lib/speed/pricing";
import type { SpeedMarket, SpeedSide } from "@/types/database";
import { useSpeedExecuteTrade } from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";

// Stake bounds for the trade UI. Server is authoritative — these are
// just guardrails so the input + preset chips reflect what's currently
// achievable. Server caps live in fee_config: speed_stake_max_usd
// (per-bet) + speed_cap_per_side_usd (per-side per market). Mig 0027.
const SPEED_STAKE_MIN = 1;
const SPEED_STAKE_MAX = 1000;
const SPEED_STAKE_PRESETS = [10, 50, 100, 1000] as const;
const MAX_AMOUNT_INPUT = 1000;

export function SpeedTradePanel({
  market,
  livePrice,
  isStale,
  onBetPlaced,
}: {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
  onBetPlaced: () => void;
}) {
  const t = useTranslations("speed");
  const tTrade = useTranslations("trade");
  const { placeBet, loading, error } = useSpeedExecuteTrade();
  const { iv, spread, extremeSpreadCoeff, realizedVol } = useSpeedFeeConfig();
  const { user } = useUser();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const [side, setSide] = useState<SpeedSide>("over");
  const [amount, setAmount] = useState<number>(0);
  const [amountInput, setAmountInput] = useState("");
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0 || market.status !== "open";

  const strike = Number(market.strike_price);
  const balance = user?.balance_usd ?? 0;

  // Pricing math — odds are always derived from the last-known oracle price
  // so the UI stays informative through transient realtime drops. Staleness
  // gates only trade execution (canTrade), not display.
  // Mig 352 (Seam 4): prefer realized-volatility σ when available so the
  // client-displayed offered prob matches what `speed_execute_trade` will
  // actually price the bet at. Falls back to fee_config IV when RV is missing.
  const sigma =
    realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
  const fairOver = livePrice
    ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
    : null;
  // Mig 352 (Seam 3): speedOfferedProb no longer returns null — it widens the
  // spread quadratically at extremes instead. The null branches below are
  // effectively dead now (only fire when fairOver is null because livePrice
  // is null), but kept for symmetry with `fairOver` gating.
  // Mig 356: pass secondsLeft so the displayed offered prob includes the
  // late-window surcharge in the last 30s — UI matches what server will charge.
  const offeredOver =
    fairOver !== null ? speedOfferedProb(fairOver, "over", spread, extremeSpreadCoeff, secondsLeft) : null;
  const offeredUnder =
    fairOver !== null ? speedOfferedProb(fairOver, "under", spread, extremeSpreadCoeff, secondsLeft) : null;
  const offeredForSide = side === "over" ? offeredOver : offeredUnder;
  const payoutPerDollar = offeredForSide ? 1 / offeredForSide : null;
  const toWin = payoutPerDollar && amount > 0 ? amount * payoutPerDollar : 0;

  // Auth-gate cascade mirroring prediction-market trade-panel.
  const isZeroBalance = !user || balance <= 0;
  const hasBalance = !!user && balance >= amount && amount > 0;
  const aboveMin = amount >= SPEED_STAKE_MIN;
  const aboveMax = amount > SPEED_STAKE_MAX;
  const canTrade =
    !expired &&
    !isStale &&
    fairOver !== null &&
    aboveMin &&
    !aboveMax &&
    hasBalance &&
    !loading;

  const handleAmountInput = useCallback((val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    let intPart = parts[0] || "";
    if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
    if (intPart.length > 3) return;
    if (parts[1] && parts[1].length > 2) return;
    const formatted = parts.length === 2 ? `${intPart}.${parts[1]}` : intPart;
    const num = parseFloat(formatted);
    if (!isNaN(num) && num > MAX_AMOUNT_INPUT) return;
    setAmountInput(formatted);
    setAmount(isNaN(num) ? 0 : num);
  }, []);

  const animRef = useRef<ReturnType<typeof fmAnimate> | null>(null);

  const animateToValue = useCallback(
    (target: number) => {
      animRef.current?.stop();
      const from = amount;
      animRef.current = fmAnimate(from, target, {
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (v) => {
          setAmountInput(Math.round(v).toString());
        },
        onComplete: () => setAmountInput(target.toString()),
      });
      setAmount(target);
    },
    [amount],
  );

  const handleAddPreset = useCallback(
    (preset: number) => {
      const next = Math.min(amount + preset, SPEED_STAKE_MAX);
      animateToValue(next);
    },
    [amount, animateToValue],
  );

  const handleMax = useCallback(() => {
    const cap = Math.min(SPEED_STAKE_MAX, Math.floor(balance));
    if (cap >= SPEED_STAKE_MIN) animateToValue(cap);
  }, [balance, animateToValue]);

  const handleAmountClick = () => inputRef.current?.focus();

  const inlineHint = useMemo(() => {
    if (amount > 0 && amount < SPEED_STAKE_MIN) {
      return {
        text: tTrade("hintMinTrade", { min: `$${SPEED_STAKE_MIN}` }),
        type: "error" as const,
      };
    }
    if (aboveMax) {
      return {
        text: tTrade("hintMaxTrade", { max: formatCurrency(SPEED_STAKE_MAX) }),
        type: "warning" as const,
      };
    }
    if (user && amount >= SPEED_STAKE_MIN && amount > balance) {
      const needed = amount - balance;
      return {
        text: tTrade("hintNeedMore", { needed: formatCurrency(needed) }),
        type: "error" as const,
      };
    }
    return null;
  }, [amount, aboveMax, balance, user, tTrade]);

  const getButtonLabel = () => {
    if (loading) return tTrade("processing");
    if (isZeroBalance) return tTrade("depositToTrade");
    if (!hasBalance && amount > 0) return tTrade("insufficientBalance");
    return `${t("placeBet")} · ${side === "over" ? t("up") : t("down")} · $${amount}`;
  };

  const isButtonDisabled = () => {
    if (loading) return true;
    if (isZeroBalance) return false; // clickable for deposit/login
    return !canTrade;
  };

  async function handleButtonClick() {
    triggerHapticConfirm();
    // Auth-gate cascade — same pattern as the regular trade panel
    // (src/app/(app)/market/[id]/page.tsx:118): no user → login, no
    // balance → deposit, otherwise place the bet.
    if (!user) {
      openLoginModal();
      return;
    }
    if (balance <= 0) {
      openDepositModal();
      return;
    }
    if (!canTrade) return;
    // Mig 369: send the IV we used to compute the displayed odds so the server
    // can detect drift and either honour the snapshot or return IV_DRIFT.
    const { error: err } = await placeBet(market.id, side, amount, sigma);
    if (!err) onBetPlaced();
  }

  // 3D pushable button — mirror of trade-panel.tsx with green/red shadows.
  const buttonBase = cn(
    "w-full h-14 font-black font-satoshi uppercase tracking-widest rounded-lg cursor-pointer text-white",
    "transition-all duration-[80ms]",
    "!border-0 !ring-0 !outline-none bg-clip-border",
  );
  const buttonColor =
    side === "over"
      ? "bg-success hover:brightness-110 shadow-[0_4px_0_0px_rgba(15,90,40,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,90,40,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,90,40,0.9)]"
      : "bg-destructive hover:brightness-110 shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]";
  const disabledStyle = "opacity-50 !translate-y-0 cursor-not-allowed";

  return (
    <div className="bg-surface rounded-lg border border-border-custom p-5">
      {/* UP / DOWN side selector — label + offered probability, mirrors the
          YES/NO buttons in trade-panel.tsx and the mobile speed bar. */}
      <div className="grid grid-cols-2 gap-3 mb-5 h-[76px]">
        <button
          type="button"
          onClick={() => setSide("over")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "over"
              ? "border-2 border-success bg-success/10 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated",
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider mb-1",
              side === "over" ? "text-success" : "text-muted-custom",
            )}
          >
            {t("up")}
          </span>
          <span
            className={cn(
              "text-xl font-black font-satoshi tabular-nums",
              side === "over" ? "text-success" : "text-text",
            )}
          >
            {offeredOver !== null ? `${Math.round(offeredOver * 100)}%` : "—"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSide("under")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "under"
              ? "border-2 border-destructive bg-destructive/10 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated",
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider mb-1",
              side === "under" ? "text-destructive" : "text-muted-custom",
            )}
          >
            {t("down")}
          </span>
          <span
            className={cn(
              "text-xl font-black font-satoshi tabular-nums",
              side === "under" ? "text-destructive" : "text-text",
            )}
          >
            {offeredUnder !== null ? `${Math.round(offeredUnder * 100)}%` : "—"}
          </span>
        </button>
      </div>

      {/* Stake input + secondary info row */}
      <div className="space-y-4">
        <div>
          <div
            className="flex items-end justify-between cursor-text"
            onClick={handleAmountClick}
          >
            <div className="flex items-center gap-1 text-sm text-muted-custom font-medium pb-1">
              <span>$ USD</span>
              <ChevronDown className="w-3 h-3" />
            </div>
            <div className="flex items-baseline">
              <span className="text-3xl font-satoshi font-black text-dim">$</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => handleAmountInput(e.target.value)}
                placeholder="0"
                className="bg-transparent text-right text-text font-black font-satoshi text-3xl placeholder:text-dim tabular-nums caret-yes max-w-[200px]"
                style={{
                  width: `${Math.max(1, amountInput.length || 1)}ch`,
                  outline: "none",
                  border: "none",
                  boxShadow: "none",
                }}
                aria-label="Stake amount"
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-dim mt-1">
            <span>
              {tTrade("hintMaxTrade", { max: formatCurrency(SPEED_STAKE_MAX) })}
            </span>
            <span>
              {tTrade("balanceLabel")} {user ? formatCurrency(balance) : "$0.00"}
            </span>
          </div>
          {inlineHint && (
            <p
              className={cn(
                "text-[11px] text-right mt-1",
                inlineHint.type === "error" ? "text-error" : "text-warning",
              )}
            >
              {inlineHint.text}
            </p>
          )}
        </div>

        {/* Quick-stake chips */}
        <div className="flex gap-2">
          {SPEED_STAKE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleAddPreset(preset)}
              className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
            >
              +${preset}
            </button>
          ))}
          <button
            type="button"
            onClick={handleMax}
            className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
          >
            {tTrade("max")}
          </button>
        </div>

        {/* "To win" row — only when stake meets minimum and pricing is available */}
        {amount >= SPEED_STAKE_MIN && toWin > 0 && (
          <div className="pt-4 border-t border-border-custom">
            <div className="flex items-end justify-between">
              <div className="flex items-end gap-1.5">
                <span className="text-sm text-muted-custom">{tTrade("toWin")}</span>
                <button
                  type="button"
                  onClick={() => setShowFeeBreakdown((s) => !s)}
                  className="text-dim hover:text-muted-custom transition-colors cursor-pointer"
                  aria-label="Show breakdown"
                >
                  <Info className="w-3 h-3" />
                </button>
              </div>
              <span className="text-2xl font-black font-satoshi text-success tabular-nums">
                ${formatNumber(toWin)}
              </span>
            </div>

            {showFeeBreakdown && (
              <div className="mt-3 pt-3 border-t border-border-custom/50 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{tTrade("amount")}</span>
                  <span className="text-text tabular-nums">{formatCurrency(amount)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{tTrade("payoutIfWins")}</span>
                  <span className="text-success tabular-nums">{formatCurrency(toWin)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
          {error}
        </div>
      )}

      {isStale && (
        <div className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning ring-1 ring-warning/30">
          {t("reconnecting")}
        </div>
      )}

      {/* Confirm button — chunkier 3D pushable */}
      <div className="mt-5">
        <Button
          type="button"
          onClick={handleButtonClick}
          disabled={isButtonDisabled()}
          className={cn(buttonBase, buttonColor, isButtonDisabled() && disabledStyle)}
        >
          {getButtonLabel()}
        </Button>
      </div>

    </div>
  );
}
