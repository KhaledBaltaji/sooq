"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  estimateSharesForAmount,
  estimateCloseValue,
  sharesToLots,
  formatLots,
  formatPrice,
} from "@/lib/market-utils";
import { formatCurrency, formatNumber, cn, triggerHaptic, triggerHapticLight, triggerHapticConfirm } from "@/lib/utils";
import { useUser } from "@/lib/auth/hooks";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useFeeRates } from "@/hooks/use-fee-rates";
import { MIN_TRADE } from "@/lib/constants";
import { applyMarkup, estimateBranchBuyPreview } from "@/lib/branch-pricing";
import type { Market, AmmState, Position } from "@/types/market";
import { XIcon } from "lucide-react";
import type { Side } from "@/types/database";
import { MIN_DISPLAY_SHARES } from "@/lib/constants";

interface MobileTradeSheetProps {
  market: Market;
  ammState: AmmState;
  position?: { yes: Position | null; no: Position | null };
  onConfirm: (side: Side, amount: number, direction: "buy" | "sell") => void;
  loading?: boolean;
  closeRequest?: { side: Side; ts: number } | null;
  initialSide?: Side;
  initialMode?: SheetMode;
  onClose: () => void;
  branchMarkup?: { yesPct: number; noPct: number };
  displayMode?: "trading" | "betting";
}

type SheetMode = "buy" | "positions";

const PRESETS = [1, 5, 10, 100] as const;

export function MobileTradeSheet({
  market,
  ammState,
  position,
  onConfirm,
  loading,
  closeRequest,
  initialSide,
  initialMode,
  onClose,
  branchMarkup,
  displayMode,
}: MobileTradeSheetProps) {
  const locale = useLocale();
  const t = useTranslations("trade");
  const { user } = useUser();
  const isDemo = useDemoMode();
  const feeRates = useFeeRates();
  // Demo reads demo_balance_usd (separate from real balance_usd) so the
  // trade sheet correctly shows the $10K sandbox balance and doesn't
  // trigger real-money deposit flow.
  const balance = isDemo
    ? Number((user as unknown as { demo_balance_usd?: number | null })?.demo_balance_usd ?? 0)
    : user?.balance_usd ?? 0;

  const [mode, setMode] = useState<SheetMode>(initialMode ?? "buy");
  const [side, setSide] = useState<Side>(initialSide ?? "yes");
  const [amountInput, setAmountInput] = useState("");
  const amount = useMemo(() => {
    const n = parseFloat(amountInput);
    return isNaN(n) ? 0 : n;
  }, [amountInput]);

  // Close position state — simplified: just confirm close all
  const [closingConfirm, setClosingConfirm] = useState<Side | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync initialSide and initialMode
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
    }
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide, initialMode]);

  // Auto-open positions mode for close requests
  useEffect(() => {
    if (closeRequest) {
      setMode("positions");
      setClosingConfirm(closeRequest.side);
    }
  }, [closeRequest?.ts]);

  // Auto-focus input
  useEffect(() => {
    if (mode === "buy") {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [mode]);

  const question = locale === "ar" ? market.question_ar : market.question_en;
  const isYes = side === "yes";

  // Positions
  const yesPos = position?.yes;
  const noPos = position?.no;
  const hasYes = !!(yesPos && yesPos.shares_held >= MIN_DISPLAY_SHARES);
  const hasNo = !!(noPos && noPos.shares_held >= MIN_DISPLAY_SHARES);
  const hasAnyPosition = hasYes || hasNo;

  // Max trade
  const maxTradeUsd = useMemo(() => {
    return Math.floor(balance * 100) / 100;
  }, [balance]);

  // Buy estimate — use branch preview when markup is active
  const buyEstimate = useMemo(() => {
    if (amount <= 0) return null;
    if (branchMarkup) {
      const markupPct = side === "yes" ? branchMarkup.yesPct : branchMarkup.noPct;
      return estimateBranchBuyPreview(
        ammState.liquidity_param, ammState.q_yes, ammState.q_no,
        side, amount, markupPct, feeRates
      );
    }
    return estimateSharesForAmount(
      ammState.liquidity_param, ammState.q_yes, ammState.q_no,
      side, amount, feeRates
    );
  }, [ammState, side, amount, branchMarkup, feeRates]);

  const toWin = (buyEstimate?.shares ?? 0) * (1 - feeRates.resolution);

  // Amount input handler
  const handleAmountInput = useCallback((val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    let intPart = parts[0] || "";
    if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
    if (intPart.length > 6) return;
    if (parts[1] && parts[1].length > 2) return;
    const formatted = parts.length === 2 ? `${intPart}.${parts[1]}` : intPart;
    const num = parseFloat(formatted);
    if (!isNaN(num) && num > 999999) return;
    triggerHapticLight();
    setAmountInput(formatted);
  }, []);

  const handleAddPreset = useCallback((preset: number) => {
    triggerHaptic();
    const next = Math.min(amount + preset, maxTradeUsd > 0 ? maxTradeUsd : 999999);
    setAmountInput(String(Math.round(next)));
  }, [amount, maxTradeUsd]);

  const handleMax = useCallback(() => {
    triggerHaptic();
    setAmountInput(String(maxTradeUsd));
  }, [maxTradeUsd]);

  // Can trade?
  const canTrade = amount >= MIN_TRADE && balance >= amount;
  const isZeroBalance = !user || balance <= 0;

  const handleTrade = useCallback(() => {
    triggerHapticConfirm();
    if (isZeroBalance) {
      onConfirm(side, amount, "buy");
      return;
    }
    if (!canTrade) return;
    onConfirm(side, amount, "buy");
  }, [side, amount, canTrade, isZeroBalance, onConfirm]);

  // ============================================================
  // Close position — simplified: close entire position
  // ============================================================
  const getCloseEstimate = useCallback((positionSide: Side) => {
    const pos = positionSide === "yes" ? yesPos : noPos;
    if (!pos || pos.shares_held < MIN_DISPLAY_SHARES) return null;
    return estimateCloseValue(
      ammState.liquidity_param, ammState.q_yes, ammState.q_no,
      positionSide, pos.shares_held, feeRates
    );
  }, [ammState, yesPos, noPos, feeRates]);

  const handleConfirmClose = useCallback((positionSide: Side) => {
    const pos = positionSide === "yes" ? yesPos : noPos;
    if (!pos) return;
    triggerHapticConfirm();
    onConfirm(positionSide, pos.shares_held, "sell");
  }, [yesPos, noPos, onConfirm]);

  // Button state
  const getButtonState = () => {
    if (loading) return { label: t("processing"), disabled: true };
    if (isZeroBalance) {
      // In demo, there's no deposit flow — prompt user to reset instead.
      return { label: isDemo ? t("resetDemoBalance") : t("depositToTrade"), disabled: false };
    }
    if (amount > 0 && amount > balance) return { label: t("insufficientBalance"), disabled: true };
    if (!canTrade) return { label: t("trade"), disabled: true };
    return { label: t("trade"), disabled: false };
  };

  const btnState = getButtonState();

  // ===== RENDER =====
  return (
    <div className="px-4 pb-8 pt-1">
      {/* Header: Buy / Positions toggle + side badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-0.5 rounded-lg p-0.5 bg-[var(--bg)]">
          <button
            onClick={() => { setMode("buy"); setClosingConfirm(null); }}
            className={cn(
              "px-4 py-1.5 text-[13px] font-semibold rounded-md transition-all duration-200 min-h-11",
              mode === "buy"
                ? "bg-elevated text-text"
                : "text-muted-custom"
            )}
          >
            {t("buy")}
          </button>
          <button
            onClick={() => setMode("positions")}
            className={cn(
              "px-4 py-1.5 text-[13px] font-semibold rounded-md transition-all duration-200 min-h-11",
              mode === "positions"
                ? "bg-elevated text-text"
                : "text-muted-custom"
            )}
          >
            {t("positions")}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {mode === "buy" && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md",
                isYes ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
              )}
            >
              {isYes ? "YES" : "NO"}
            </motion.span>
          )}
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-full text-muted-custom hover:text-text transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        {mode === "buy" ? (
          /* ===== BUY MODE ===== */
          <motion.div
            key="buy"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* Market question */}
            <p className="text-[13px] text-muted-custom leading-snug mb-5">{question}</p>

            {/* Centered amount — tappable input */}
            <div
              className="flex items-center justify-between mb-4"
              onClick={() => inputRef.current?.focus()}
            >
              <button
                onClick={(e) => { e.stopPropagation(); triggerHaptic(); setAmountInput(String(Math.max(0, amount - 5))); }}
                disabled={amount <= 0}
                className={cn(
                  "text-2xl text-muted-custom select-none w-11 h-11 flex items-center justify-center rounded-full transition-opacity",
                  amount <= 0 && "opacity-20"
                )}
              >
                −
              </button>

              <div className="relative flex items-baseline">
                <span className="text-[40px] font-black font-satoshi text-dim select-none leading-none">$</span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={amountInput}
                  onChange={(e) => handleAmountInput(e.target.value)}
                  placeholder="0"
                  className="bg-transparent text-[40px] font-black font-satoshi text-text placeholder:text-dim tabular-nums caret-yes leading-none"
                  style={{
                    width: `${Math.max(1, (amountInput || "0").length) * 0.65}em`,
                    minWidth: "0.65em",
                    outline: "none",
                    border: "none",
                    boxShadow: "none",
                  }}
                />
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); triggerHaptic(); setAmountInput(String(amount + 5)); }}
                className="text-2xl text-muted-custom select-none w-11 h-11 flex items-center justify-center rounded-full"
              >
                +
              </button>
            </div>

            {/* Quick-add chips */}
            <div className="flex gap-2 mb-3 justify-center">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => handleAddPreset(p)}
                  className="px-4 py-2.5 text-[12px] font-medium rounded-full bg-[var(--border)] hover:bg-dim text-muted-custom transition-colors active:scale-95 min-h-11"
                >
                  +${p}
                </button>
              ))}
              <button
                onClick={handleMax}
                className="px-4 py-2.5 text-[12px] font-medium rounded-full bg-[var(--border)] hover:bg-dim text-muted-custom transition-colors active:scale-95 min-h-11"
              >
                {t("max")}
              </button>
            </div>

            {/* Balance */}
            <p className="text-center text-xs text-dim mb-3">
              {t("balanceLabel")} {user ? formatCurrency(balance) : "$0.00"}
            </p>

            {/* To win — animated reveal */}
            <AnimatePresence>
              {amount >= MIN_TRADE && buyEstimate && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="flex items-center justify-between py-3 mb-2 border-t border-border-custom">
                    <span className="text-sm text-muted-custom">{t("toWin")}</span>
                    <span className="text-xl font-black font-satoshi text-success tabular-nums">
                      ${formatNumber(toWin)}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Inline validation */}
            <AnimatePresence>
              {amount > 0 && amount < MIN_TRADE && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-center text-error mb-2"
                >
                  {t("hintMinTrade", { min: `$${MIN_TRADE}` })}
                </motion.p>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {user && amount >= MIN_TRADE && amount > balance && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-center text-error mb-2"
                >
                  {t("hintNeedMore", { needed: formatCurrency(amount - balance) })}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Trade button */}
            <button
              onClick={handleTrade}
              disabled={btnState.disabled}
              className={cn(
                "w-full h-[52px] rounded-xl font-satoshi font-bold text-[15px] text-white",
                "transition-all duration-[80ms]",
                "shadow-[0_4px_0_0px] active:translate-y-[3px] active:shadow-[0_1px_0_0px]",
                isYes
                  ? "bg-yes shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]"
                  : "bg-no shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]",
                btnState.disabled && "opacity-40 !translate-y-0 !shadow-none"
              )}
            >
              {btnState.label}
            </button>
          </motion.div>
        ) : (
          /* ===== POSITIONS MODE ===== */
          <motion.div
            key="positions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {!hasAnyPosition ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-custom">{t("noPositions")}</p>
              </div>
            ) : (
              <>
                {[yesPos, noPos].filter(Boolean).map((pos) => {
                  if (!pos || pos.shares_held < MIN_DISPLAY_SHARES) return null;
                  const posSide = pos.side as Side;
                  const posPrice = posSide === "yes"
                    ? ammState.current_yes_price
                    : ammState.current_no_price;
                  const posValue = pos.shares_held * posPrice;
                  const costBasis = pos.shares_held * pos.avg_entry_price;
                  const pnl = posValue - costBasis;
                  const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
                  const isProfit = pnl >= 0;
                  const closeEst = getCloseEstimate(posSide);
                  const isConfirming = closingConfirm === posSide;

                  return (
                    <motion.div
                      key={pos.side}
                      layout
                      className="bg-elevated rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                            posSide === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
                          )}>
                            {posSide.toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-text tabular-nums">
                            {formatLots(pos.shares_held)} {t("lots").toLowerCase()}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-text tabular-nums block">
                            {formatCurrency(posValue)}
                          </span>
                          <span className={cn(
                            "text-xs font-semibold tabular-nums",
                            isProfit ? "text-success" : "text-error"
                          )}>
                            {isProfit ? "+" : ""}{formatCurrency(pnl)} ({isProfit ? "+" : ""}{pnlPct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-4 text-xs mb-3">
                        <div>
                          <span className="text-muted-custom">{t("entryPrice")}</span>
                          <span className="text-text ml-1 tabular-nums">{formatPrice(pos.avg_entry_price, "neutral")}</span>
                        </div>
                        <div>
                          <span className="text-muted-custom">{t("currentPrice")}</span>
                          <span className="text-text ml-1 tabular-nums">{formatPrice(posPrice, "sell")}</span>
                        </div>
                      </div>

                      <AnimatePresence mode="wait">
                        {isConfirming && closeEst ? (
                          /* Confirm close — simple: shows what you get */
                          <motion.div
                            key="confirm"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="bg-[var(--bg)] rounded-lg p-3 mb-3 space-y-1.5">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-custom">{t("youReceive")}</span>
                                <span className="text-success font-bold font-satoshi tabular-nums text-base">
                                  {formatCurrency(closeEst.netProceeds)}
                                </span>
                              </div>
                              <div className="flex justify-between text-xs text-muted-custom">
                                <span>{t("fee")}</span>
                                <span className="tabular-nums">-{formatCurrency(closeEst.fee + closeEst.closeFee)}</span>
                              </div>
                            </div>
                            <div className="flex gap-2 pb-1">
                              <button
                                onClick={() => setClosingConfirm(null)}
                                className="flex-1 h-11 font-semibold text-sm text-muted-custom bg-[var(--bg)] rounded-lg transition-colors"
                              >
                                {t("cancel")}
                              </button>
                              <button
                                onClick={() => handleConfirmClose(posSide)}
                                disabled={loading}
                                className={cn(
                                  "flex-1 h-11 font-semibold text-sm text-white rounded-lg transition-all duration-[80ms]",
                                  "shadow-[0_3px_0_0px] active:translate-y-[2px] active:shadow-[0_1px_0_0px]",
                                  posSide === "yes"
                                    ? "bg-yes shadow-[0_3px_0_0px_rgba(15,60,140,0.9)]"
                                    : "bg-no shadow-[0_3px_0_0px_rgba(140,15,30,0.9)]",
                                  loading && "opacity-40"
                                )}
                              >
                                {loading ? t("processing") : t("closePosition")}
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          /* Close button */
                          <button
                            key="close-btn"
                            onClick={() => { triggerHaptic(); setClosingConfirm(posSide); }}
                            className="w-full h-11 font-semibold text-sm text-text bg-[var(--bg)] hover:bg-surface rounded-lg transition-colors"
                          >
                            {t("closePosition")}
                          </button>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
