"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence, animate as fmAnimate } from "framer-motion";
import type { Market, AmmState, Position } from "@/types/market";
import type { Side } from "@/types/database";
import { Button } from "@/components/ui/button";
import { MIN_TRADE, MAX_TRADE_PCT_OF_LIQUIDITY } from "@/lib/constants";
import {
  estimateSharesForAmount,
  estimateCloseValue,
  estimateCostForShares,
  sharesToLots,
  lotsToShares,
  formatLots,
} from "@/lib/market-utils";
import { formatCurrency, formatNumber, cn, triggerHapticConfirm } from "@/lib/utils";
import {
  applyMarkup,
  toDecimalOdds,
  formatDecimalOdds,
  estimateBranchBuyPreview,
} from "@/lib/branch-pricing";
import { useUser } from "@/lib/auth/hooks";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useFeeRates } from "@/hooks/use-fee-rates";
import { Info, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

interface TradePanelProps {
  market: Market;
  ammState: AmmState;
  position?: { yes: Position | null; no: Position | null };
  onConfirm: (side: Side, amount: number, direction: "buy" | "sell") => void;
  loading?: boolean;
  initialSide?: Side;
  /** Branch markup percentages (0-1). When set, prices are markup-adjusted. */
  branchMarkup?: { yesPct: number; noPct: number };
  /** Branch exit fee percentage (0-1). Shown in fee breakdown. */
  branchExitFee?: number;
  /** Display mode: "trading" (percentages) or "betting" (decimal odds). Default "trading". */
  displayMode?: "trading" | "betting";
}

type InputMode = "usd" | "lots";

const USD_PRESETS = [10, 50, 100, 500] as const;
const LOTS_PRESETS = [0.01, 0.05, 0.1, 1] as const;

export function TradePanel({ market, ammState, position, onConfirm, loading, initialSide, branchMarkup, branchExitFee, displayMode = "trading" }: TradePanelProps) {
  const { user } = useUser();
  const isDemo = useDemoMode();
  const feeRates = useFeeRates();
  const t = useTranslations("trade");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState<number>(0);
  const [amountInput, setAmountInput] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    if (typeof window === "undefined") return "usd";
    return (localStorage.getItem("trade-input-mode") as InputMode) || "usd";
  });
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-select side when opened from mobile trade bar
  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);

  // Prices
  const currentYesPrice = ammState.current_yes_price;
  const currentNoPrice = ammState.current_no_price;
  // In /demo/* routes, trade panel reads demo_balance_usd (the $10K sandbox).
  // Without this, the panel reports "insufficient balance" and prompts deposit.
  const balance = isDemo
    ? Number((user as unknown as { demo_balance_usd?: number | null })?.demo_balance_usd ?? 0)
    : user?.balance_usd ?? 0;

  const isBranch = !!branchMarkup;

  // Bid/ask spread prices using $5 reference trade
  const spreadPrices = useMemo(() => {
    const REF = 5;
    const b = ammState.liquidity_param;
    const qY = ammState.q_yes;
    const qN = ammState.q_no;

    const buyYes = estimateSharesForAmount(b, qY, qN, "yes", REF, feeRates);
    const buyNo = estimateSharesForAmount(b, qY, qN, "no", REF, feeRates);

    let askYes = parseFloat((ammState.current_yes_price * 100).toFixed(1));
    let askNo = parseFloat((100 - askYes).toFixed(1));

    // Branch markup: adjust displayed ask prices
    if (branchMarkup) {
      const grossYes = applyMarkup(ammState.current_yes_price, branchMarkup.yesPct);
      const grossNo = applyMarkup(ammState.current_no_price, branchMarkup.noPct);
      askYes = parseFloat((grossYes * 100).toFixed(1));
      askNo = parseFloat((grossNo * 100).toFixed(1));
    }

    const sellYes = estimateCloseValue(b, qY, qN, "yes", buyYes.shares, feeRates);
    const sellNo = estimateCloseValue(b, qY, qN, "no", buyNo.shares, feeRates);
    const bidYes = Math.floor((sellYes.netProceeds / buyYes.shares) * 100);
    const bidNo = Math.floor((sellNo.netProceeds / buyNo.shares) * 100);

    return { askYes, askNo, bidYes, bidNo };
  }, [ammState, branchMarkup, feeRates]);

  // Max trade calculation
  const maxTradeUsd = useMemo(() => {
    const maxShares = MAX_TRADE_PCT_OF_LIQUIDITY * ammState.liquidity_param;
    const price = side === "yes" ? currentYesPrice : currentNoPrice;
    const estimatedMaxUsd = Math.floor(maxShares * price * 1.1);
    return Math.min(Math.floor(balance * 100) / 100, estimatedMaxUsd);
  }, [ammState.liquidity_param, side, currentYesPrice, currentNoPrice, balance]);

  // ============================================================
  // BUY estimates
  // ============================================================

  // Buy in USD mode
  const buyUsdEstimate = useMemo(() => {
    if (inputMode !== "usd" || amount <= 0) return null;
    return estimateSharesForAmount(
      ammState.liquidity_param, ammState.q_yes, ammState.q_no,
      side, amount, feeRates
    );
  }, [ammState, side, amount, inputMode, feeRates]);

  // Buy in Lots mode — convert lots to shares for backend math
  const buySharesEstimate = useMemo(() => {
    if (inputMode !== "lots" || amount <= 0) return null;
    return estimateCostForShares(
      ammState.liquidity_param, ammState.q_yes, ammState.q_no,
      side, lotsToShares(amount), feeRates
    );
  }, [ammState, side, amount, inputMode, feeRates]);

  // Branch buy estimate (markup-adjusted)
  const branchBuyEstimate = useMemo(() => {
    if (!isBranch || inputMode !== "usd" || amount <= 0) return null;
    const markupPct = side === "yes" ? branchMarkup!.yesPct : branchMarkup!.noPct;
    return estimateBranchBuyPreview(
      ammState.liquidity_param, ammState.q_yes, ammState.q_no,
      side, amount, markupPct, feeRates
    );
  }, [ammState, side, amount, inputMode, isBranch, branchMarkup, feeRates]);

  // Unified buy estimate for display
  const estimate = inputMode === "usd" ? buyUsdEstimate : null;
  const buyShares = isBranch && inputMode === "usd"
    ? (branchBuyEstimate?.shares ?? 0)
    : inputMode === "usd"
      ? (buyUsdEstimate?.shares ?? 0)
      : lotsToShares(amount);
  const buyCost = inputMode === "usd"
    ? amount
    : (buySharesEstimate?.cost ?? 0);
  const buyFee = isBranch && inputMode === "usd"
    ? (branchBuyEstimate?.platformFee ?? 0)
    : inputMode === "usd"
      ? (buyUsdEstimate?.fee ?? 0)
      : (buySharesEstimate?.fee ?? 0);
  const branchMarkupFee = isBranch && inputMode === "usd"
    ? (branchBuyEstimate?.markupFee ?? 0)
    : 0;
  const toWin = buyShares * (1 - feeRates.resolution);

  // ============================================================
  // Input handlers
  // ============================================================

  const MAX_AMOUNT = 999999;
  const handleAmountInput = useCallback((val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    let intPart = parts[0] || "";
    if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
    if (intPart.length > 6) return;
    const maxDecimals = inputMode === "lots" ? 3 : 2;
    if (parts[1] && parts[1].length > maxDecimals) return;
    const formatted = parts.length === 2 ? `${intPart}.${parts[1]}` : intPart;
    const num = parseFloat(formatted);
    if (!isNaN(num) && num > MAX_AMOUNT) return;
    setAmountInput(formatted);
    setAmount(isNaN(num) ? 0 : num);
  }, [inputMode]);

  const animRef = useRef<ReturnType<typeof fmAnimate> | null>(null);

  const handleAddPreset = useCallback((preset: number) => {
    setAmount((prev) => {
      const next = Math.min(prev + preset, MAX_AMOUNT);
      animRef.current?.stop();
      animRef.current = fmAnimate(prev, next, {
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (v) => {
          const rounded = inputMode === "lots"
            ? Math.round(v * 1000) / 1000
            : Math.round(v);
          setAmountInput(rounded.toString());
        },
        onComplete: () => {
          setAmountInput(next.toString());
        },
      });
      return next;
    });
  }, [inputMode]);

  const animateToValue = useCallback((target: number) => {
    animRef.current?.stop();
    const from = amount;
    const isLots = inputMode === "lots";
    animRef.current = fmAnimate(from, target, {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        const rounded = isLots
          ? Math.round(v * 1000) / 1000
          : Math.round(v);
        setAmountInput(rounded.toString());
      },
      onComplete: () => setAmountInput(target.toString()),
    });
    setAmount(target);
  }, [amount, inputMode]);

  const handleMax = useCallback(() => {
    if (inputMode === "usd") {
      animateToValue(maxTradeUsd);
    } else {
      const maxShares = MAX_TRADE_PCT_OF_LIQUIDITY * ammState.liquidity_param;
      const maxLots = Math.floor(sharesToLots(maxShares) * 1000) / 1000;
      animateToValue(maxLots);
    }
  }, [inputMode, maxTradeUsd, ammState, animateToValue]);

  const handleAmountClick = () => inputRef.current?.focus();

  const toggleInputMode = useCallback(() => {
    setInputMode((prev) => {
      const next = prev === "usd" ? "lots" : "usd";
      localStorage.setItem("trade-input-mode", next);
      return next;
    });
    setAmount(0);
    setAmountInput("");
  }, []);

  // Fee-aware balance check: actual cost includes the 0.5% explicit fee
  const effectiveCost = inputMode === "usd" ? amount : buyCost;
  const hasBalance = user && balance >= effectiveCost && effectiveCost > 0;
  const isZeroBalance = !user || balance <= 0;

  const canTrade = useMemo(() => {
    if (inputMode === "usd") return amount >= MIN_TRADE && !!hasBalance;
    return buySharesEstimate ? buySharesEstimate.cost >= MIN_TRADE && balance >= buySharesEstimate.cost : false;
  }, [inputMode, amount, hasBalance, buySharesEstimate, balance]);

  // ============================================================
  // Confirm handler
  // ============================================================

  const handleConfirm = useCallback(() => {
    if (!canTrade) return;
    if (inputMode === "usd" && amount >= MIN_TRADE && balance >= amount) {
      onConfirm(side, amount, "buy");
    } else if (inputMode === "lots" && buySharesEstimate && buySharesEstimate.cost >= MIN_TRADE && balance >= buySharesEstimate.cost) {
      let cost = Math.ceil(buySharesEstimate.cost * 100) / 100;
      // Branch markup: inflate canonical cost so the RPC extracts markup and still
      // delivers the expected number of shares to the AMM
      if (isBranch) {
        const markupPct = side === "yes" ? branchMarkup!.yesPct : branchMarkup!.noPct;
        if (markupPct > 0 && markupPct < 1) {
          cost = Math.ceil((cost / (1 - markupPct)) * 100) / 100;
        }
      }
      onConfirm(side, cost, "buy");
    }
  }, [canTrade, inputMode, amount, side, onConfirm, buySharesEstimate, balance, isBranch, branchMarkup]);

  // Inline validation hint
  const inlineHint = useMemo(() => {
    const effectiveAmt = inputMode === "usd" ? amount : (buySharesEstimate?.cost ?? 0);
    if (effectiveAmt > 0 && effectiveAmt < MIN_TRADE) {
      return { text: t("hintMinTrade", { min: `$${MIN_TRADE}` }), type: "error" as const };
    }
    if (effectiveAmt > maxTradeUsd && maxTradeUsd > 0) {
      return { text: t("hintMaxTrade", { max: formatCurrency(maxTradeUsd) }), type: "warning" as const };
    }
    if (user && effectiveAmt >= MIN_TRADE && effectiveAmt > balance) {
      const needed = effectiveAmt - balance;
      return { text: t("hintNeedMore", { needed: formatCurrency(needed) }), type: "error" as const };
    }
    return null;
  }, [amount, inputMode, buySharesEstimate, maxTradeUsd, balance, user, t]);

  // Button label logic
  const getButtonLabel = () => {
    if (loading) return t("processing");
    if (isZeroBalance) return isDemo ? t("resetDemoBalance") : t("depositToTrade");
    if (!hasBalance && (inputMode === "usd" ? amount : buyCost) > 0) return t("insufficientBalance");
    return side === "yes" ? t("buyYes") : t("buyNo");
  };

  const isButtonDisabled = () => {
    if (loading) return true;
    if (isZeroBalance) return false; // clickable for deposit/login
    return !canTrade;
  };

  const handleButtonClick = () => {
    triggerHapticConfirm();
    if (isZeroBalance) {
      onConfirm(side, amount, "buy");
      return;
    }
    handleConfirm();
  };

  // 3D button classes — chunkier h-16 with deeper 8px shadow for a more
  // pronounced pushable feel. Matches the speed-trade-panel button.
  const buttonBase = cn(
    "w-full h-16 font-black font-satoshi uppercase tracking-widest rounded-lg cursor-pointer text-white",
    "transition-all duration-[80ms]",
    "!border-0 !ring-0 !outline-none bg-clip-border"
  );
  const button3d = (color: "blue" | "red") => {
    const bg = color === "blue" ? "bg-yes" : "bg-no";
    const shadow =
      color === "blue"
        ? "shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]"
        : "shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]";
    return cn(buttonBase, bg, "hover:brightness-110", shadow);
  };
  const disabledStyle = "opacity-50 !translate-y-0 cursor-not-allowed";

  const buttonColor = (): "blue" | "red" => side === "yes" ? "blue" : "red";

  // ============================================================
  // Input mode toggle component
  // ============================================================
  const InputModeToggle = () => (
    <button
      onClick={toggleInputMode}
      className="flex items-center gap-1 text-sm text-muted-custom font-medium pb-1 hover:text-text transition-colors cursor-pointer"
    >
      <span>{inputMode === "usd" ? "$ USD" : "# Lots"}</span>
      <ChevronDown className="w-3 h-3" />
    </button>
  );

  // ============================================================
  // Presets for current mode
  // ============================================================
  const currentPresets = inputMode === "usd" ? USD_PRESETS : LOTS_PRESETS;
  const presetPrefix = inputMode === "usd" ? "+$" : "+";

  return (
    <div className="bg-surface rounded-lg border border-border-custom p-5">
      {/* YES/NO price selector */}
      <div className="grid grid-cols-2 gap-3 mb-5 h-[76px]">
        <button
          onClick={() => setSide("yes")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "yes"
              ? "border-2 border-yes bg-yes/10 shadow-[0_0_20px_rgba(45,140,255,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated"
          )}
        >
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wider mb-1",
            side === "yes" ? "text-yes" : "text-muted-custom"
          )}>Yes</span>
          <span className="text-xl font-black font-satoshi text-text">
            {displayMode === "betting" && branchMarkup
              ? formatDecimalOdds(toDecimalOdds(applyMarkup(ammState.current_yes_price, branchMarkup.yesPct), feeRates.resolution))
              : `${spreadPrices.askYes.toFixed(1)}%`}
          </span>
        </button>
        <button
          onClick={() => setSide("no")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "no"
              ? "border-2 border-no bg-no/10 shadow-[0_0_20px_rgba(255,71,87,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated"
          )}
        >
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wider mb-1",
            side === "no" ? "text-no" : "text-muted-custom"
          )}>No</span>
          <span className="text-xl font-black font-satoshi text-text">
            {displayMode === "betting" && branchMarkup
              ? formatDecimalOdds(toDecimalOdds(applyMarkup(ammState.current_no_price, branchMarkup.noPct), feeRates.resolution))
              : `${spreadPrices.askNo.toFixed(1)}%`}
          </span>
        </button>
      </div>

      {/* Amount input UI */}
      <div className="space-y-4">
        {/* Amount display with mode toggle */}
        <div>
          <div
            className="flex items-end justify-between cursor-text"
            onClick={handleAmountClick}
          >
            <InputModeToggle />
            <div className="flex items-baseline">
              <span className="text-3xl font-satoshi font-black text-dim">
                {inputMode === "usd" ? "$" : "#"}
              </span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => handleAmountInput(e.target.value)}
                placeholder="0"
                className="bg-transparent text-right text-text font-black font-satoshi text-3xl placeholder:text-dim tabular-nums caret-yes max-w-[200px]"
                style={{ width: `${Math.max(1, amountInput.length || 1)}ch`, outline: "none", border: "none", boxShadow: "none" }}
                aria-label="Trade amount"
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-dim mt-1">
            <span>{t("hintMaxTrade", { max: formatCurrency(maxTradeUsd) })}</span>
            <span>{t("balanceLabel")} {user ? formatCurrency(balance) : "$0.00"}</span>
          </div>
          {inlineHint && (
            <p className={cn(
              "text-[11px] text-right mt-1",
              inlineHint.type === "error" ? "text-error" : "text-warning"
            )}>
              {inlineHint.text}
            </p>
          )}
        </div>

        {/* Additive quick-add presets */}
        <div className="flex gap-2">
          {currentPresets.map((preset) => (
            <button
              key={preset}
              onClick={() => handleAddPreset(preset)}
              className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
            >
              {presetPrefix}{preset}
            </button>
          ))}
          <button
            onClick={handleMax}
            className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
          >
            {t("max")}
          </button>
        </div>

        {/* "To win" estimate — USD mode */}
        {inputMode === "usd" && estimate && amount >= MIN_TRADE && (
          <div className="pt-4 border-t border-border-custom">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-sm text-muted-custom">{t("toWin")}</span>
                <button
                  onClick={() => setShowFeeBreakdown(!showFeeBreakdown)}
                  className="text-dim hover:text-muted-custom transition-colors cursor-pointer mt-0.5"
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
                  <span className="text-muted-custom">{t("amount")}</span>
                  <span className="text-text tabular-nums">{formatCurrency(amount)}</span>
                </div>
                {branchMarkupFee > 0 && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-custom">Markup</span>
                    <span className="text-muted-custom tabular-nums">-{formatCurrency(branchMarkupFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("fee")}</span>
                  <span className="text-muted-custom tabular-nums">-{formatCurrency(buyFee)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("estLots")}</span>
                  <span className="text-text tabular-nums">{formatLots(buyShares)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("payoutIfWins")}</span>
                  <span className="text-success tabular-nums">{formatCurrency(toWin)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* "To win" estimate — Shares mode */}
        {inputMode === "lots" && buySharesEstimate && amount > 0 && (
          <div className="pt-4 border-t border-border-custom">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-sm text-muted-custom">{t("toWin")}</span>
                <button
                  onClick={() => setShowFeeBreakdown(!showFeeBreakdown)}
                  className="text-dim hover:text-muted-custom transition-colors cursor-pointer mt-0.5"
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
                  <span className="text-muted-custom">{t("lots")}</span>
                  <span className="text-text tabular-nums">{formatNumber(amount)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("cost")}</span>
                  <span className="text-text tabular-nums">{formatCurrency(buySharesEstimate.cost)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("fee")}</span>
                  <span className="text-muted-custom tabular-nums">-{formatCurrency(buySharesEstimate.fee)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{t("payoutIfWins")}</span>
                  <span className="text-success tabular-nums">{formatCurrency(toWin)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm button — 3D pushable effect */}
      <div className="mt-5">
        <Button
          onClick={handleButtonClick}
          disabled={isButtonDisabled()}
          className={cn(
            button3d(buttonColor()),
            isButtonDisabled() && disabledStyle
          )}
        >
          {getButtonLabel()}
        </Button>
      </div>
    </div>
  );
}
