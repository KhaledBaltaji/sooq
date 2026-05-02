"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronUp, ChevronDown, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { springs, slideUp } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { TradingViewChart } from "./trading-view-chart";
import { Confetti } from "@/components/ui/confetti";
import { useExecuteTrade } from "@/hooks/use-execute-trade";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { mapTradeError } from "@/lib/trade-utils";
import { sharesToLots, lotsToShares, getMaxTradeUsd } from "@/lib/market-utils";
import { MIN_TRADE, MAX_TRADE_PCT_OF_LIQUIDITY } from "@/lib/constants";
import {
  usePriceHistory,
  getAvailablePeriods,
  getDefaultPeriod,
  type TimePeriod,
} from "@/hooks/use-price-history";
import type { Market, AmmState, Position } from "@/types/market";
import type { Side } from "@/types/database";

type TradeInputMode = "usd" | "lots";

interface FullscreenChartProps {
  open: boolean;
  onClose: () => void;
  market: Market;
  ammState: AmmState;
  position?: { yes: Position | null; no: Position | null };
  onTradeComplete?: () => void;
  /**
   * Branch markup applied to YES side. When > 0, the price history line reflects
   * the branch-quoted price (`canonical / (1 - pct)`). Pass from useBranchContext()
   * on branch storefront pages; leave 0 on main site.
   * NOTE: trade execution inside FullscreenChart still routes through the main-site
   * useExecuteTrade path — execution-side branch-awareness is a separate concern.
   */
  yesMarkupPct?: number;
  /** Branch markup applied to NO side. See `yesMarkupPct` for semantics. */
  noMarkupPct?: number;
}

export function FullscreenChart({
  open,
  onClose,
  market,
  ammState,
  position,
  onTradeComplete,
  yesMarkupPct = 0,
  noMarkupPct = 0,
}: FullscreenChartProps) {
  const t = useTranslations("trade");
  const tToast = useTranslations("toast");
  const tMarket = useTranslations("market");

  // Chart state
  const [period, setPeriod] = useState<TimePeriod>(() => getDefaultPeriod(market.created_at));
  const [chartSide, setChartSide] = useState<"yes" | "no" | "both">("yes");

  const availablePeriods = useMemo(
    () => getAvailablePeriods(market.created_at),
    [market.created_at]
  );

  const { data, loading: chartLoading } = usePriceHistory(
    market.id,
    period,
    market.created_at,
    ammState,
    yesMarkupPct,
    noMarkupPct,
  );

  // Prices
  const yesPriceRaw = (ammState.current_yes_price ?? 0.5) * 100;
  const yesPrice = yesPriceRaw.toFixed(1);
  const yesPriceInt = Math.ceil(yesPriceRaw);
  const noPriceInt = Math.ceil(100 - yesPriceRaw);

  // Trade hooks
  const { executeTrade, loading: trading } = useExecuteTrade();
  const { user, refetch: refetchUser, adjustBalance } = useUser();
  const isDemo = useDemoMode();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();

  // Trade state
  const [tradeAmount, setTradeAmount] = useState(10);
  const [tradeInputMode, setTradeInputMode] = useState<TradeInputMode>(() => {
    if (typeof window === "undefined") return "usd";
    return (localStorage.getItem("trade-input-mode") as TradeInputMode) || "usd";
  });
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const isTrading = trading || tradeInProgress;

  // T&C state
  const [tcAccepted, setTcAccepted] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("chart-trading-tc-accepted") === "true";
  });
  const [showTcModal, setShowTcModal] = useState(false);
  const [pendingTradeSide, setPendingTradeSide] = useState<Side | null>(null);

  // Feedback state
  const [tradeToast, setTradeToast] = useState<{ side: Side; title: string; desc: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Auto-dismiss trade toast
  useEffect(() => {
    if (!tradeToast) return;
    const timer = setTimeout(() => setTradeToast(null), 2500);
    return () => clearTimeout(timer);
  }, [tradeToast]);

  // Close mode dropdown on outside click
  useEffect(() => {
    if (!modeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modeDropdownOpen]);

  // Stepper handlers
  const handleSwitchMode = useCallback((mode: TradeInputMode) => {
    setTradeInputMode(mode);
    localStorage.setItem("trade-input-mode", mode);
    setTradeAmount(mode === "usd" ? 10 : 0.01);
    setModeDropdownOpen(false);
  }, []);

  const handleQuickAdd = useCallback((add: number) => {
    setTradeAmount((prev) => +(prev + add).toFixed(2));
  }, []);

  const handleIncrement = useCallback(() => {
    const step = tradeInputMode === "usd" ? 10 : 0.01;
    setTradeAmount((prev) => +(prev + step).toFixed(2));
  }, [tradeInputMode]);

  const handleDecrement = useCallback(() => {
    const step = tradeInputMode === "usd" ? 10 : 0.01;
    const min = tradeInputMode === "usd" ? MIN_TRADE : 0.01;
    setTradeAmount((prev) => Math.max(min, +(prev - step).toFixed(2)));
  }, [tradeInputMode]);

  // Trade execution
  const handleTrade = useCallback(async (side: Side, amount: number) => {
    if (!user) {
      openLoginModal();
      return;
    }

    // Demo reads demo_balance_usd and doesn't open the real-money deposit
    // modal on insufficient balance.
    const freshUser = await refetchUser();
    const u = (freshUser ?? user) as unknown as { balance_usd: number; demo_balance_usd?: number | null };
    const currentBalance = isDemo ? Number(u.demo_balance_usd ?? 0) : u.balance_usd;
    if (currentBalance <= 0 || currentBalance < amount) {
      if (isDemo) {
        toast.error(tToast("tradeFailed"), {
          description: "Not enough demo balance. Reset in Settings.",
        });
      } else {
        openDepositModal();
      }
      return;
    }

    setTradeInProgress(true);
    try {
      const { data: result, error: tradeErr } = await executeTrade(market.id, side, "buy", amount);
      if (result) {
        adjustBalance(-amount);
        await refetchUser();
        onTradeComplete?.();
        setShowConfetti(true);
        const lots = sharesToLots(result.shares).toFixed(3);
        const sideLabel = side.toUpperCase();
        setTradeToast({
          side,
          title: tToast("tradePlaced"),
          desc: tMarket("tradePlacedDesc", { shares: lots, side: sideLabel }),
        });
        if (result.price_impact_warning) {
          toast.warning(tToast("largePriceImpact"), { description: tMarket("largePriceImpactDesc") });
        }
      } else if (tradeErr) {
        toast.error(tToast("tradeFailed"), { description: mapTradeError(tradeErr, t, getMaxTradeUsd(ammState)) });
      }
    } finally {
      setTradeInProgress(false);
    }
  }, [user, market.id, ammState, executeTrade, refetchUser, adjustBalance, openLoginModal, openDepositModal, onTradeComplete, t, tToast, tMarket]);

  const handleOneClickTrade = useCallback((side: Side) => {
    if (!tcAccepted) {
      setPendingTradeSide(side);
      setShowTcModal(true);
      return;
    }
    if (tradeInputMode === "usd" && tradeAmount < MIN_TRADE) {
      toast.error(tToast("tradeFailed"), { description: t("errorTradeTooSmall") });
      return;
    }
    const amount = tradeInputMode === "lots" ? lotsToShares(tradeAmount) : tradeAmount;
    handleTrade(side, amount);
  }, [tcAccepted, tradeInputMode, tradeAmount, handleTrade, t, tToast]);

  const handleAcceptTc = useCallback(() => {
    setTcAccepted(true);
    localStorage.setItem("chart-trading-tc-accepted", "true");
    setShowTcModal(false);
    if (pendingTradeSide) {
      const side = pendingTradeSide;
      setPendingTradeSide(null);
      if (tradeInputMode === "usd" && tradeAmount < MIN_TRADE) {
        toast.error(tToast("tradeFailed"), { description: t("errorTradeTooSmall") });
        return;
      }
      const amount = tradeInputMode === "lots" ? lotsToShares(tradeAmount) : tradeAmount;
      handleTrade(side, amount);
    }
  }, [pendingTradeSide, tradeInputMode, tradeAmount, handleTrade, t, tToast]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="fullscreen-chart"
          initial={slideUp.initial}
          animate={slideUp.animate}
          exit={slideUp.exit}
          transition={springs.snappy}
          className="fixed inset-0 z-[60] bg-bg flex flex-col"
        >
          <Confetti trigger={showConfetti} onComplete={() => setShowConfetti(false)} />

          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-3 pb-2 shrink-0">
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-custom" />
            </button>
            <h2 className="flex-1 text-sm font-bold font-satoshi text-text line-clamp-1 leading-tight">
              {market.question_en}
            </h2>
            <span className="text-lg font-black font-satoshi tabular-nums text-yes shrink-0">
              {yesPrice}%
            </span>
            {/* Y/N toggle */}
            <div className="flex border border-border-custom rounded-md overflow-hidden shrink-0">
              <button
                onClick={() => setChartSide((prev) => {
                  const yesOn = prev === "yes" || prev === "both";
                  const noOn = prev === "no" || prev === "both";
                  if (yesOn && noOn) return "no";
                  if (yesOn) return "yes";
                  return noOn ? "both" : "yes";
                })}
                className={cn(
                  "w-7 h-6 text-[10px] font-bold font-satoshi flex items-center justify-center border-r border-border-custom transition-colors",
                  chartSide === "yes" || chartSide === "both"
                    ? "text-yes bg-yes/10"
                    : "text-dim/40"
                )}
              >
                Y
              </button>
              <button
                onClick={() => setChartSide((prev) => {
                  const yesOn = prev === "yes" || prev === "both";
                  const noOn = prev === "no" || prev === "both";
                  if (noOn && yesOn) return "yes";
                  if (noOn) return "no";
                  return yesOn ? "both" : "no";
                })}
                className={cn(
                  "w-7 h-6 text-[10px] font-bold font-satoshi flex items-center justify-center transition-colors",
                  chartSide === "no" || chartSide === "both"
                    ? "text-no bg-no/10"
                    : "text-dim/40"
                )}
              >
                N
              </button>
            </div>
          </div>

          {/* Chart area */}
          <div className="flex-1 relative min-h-0 px-2">
            <TradingViewChart
              data={data}
              loading={chartLoading}
              className="w-full h-full"
              side={chartSide}
              createdAt={market.created_at}
            />

            {/* Period selector overlay */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-surface/90 backdrop-blur-sm border border-border-custom rounded-full px-2 py-1.5">
              {availablePeriods.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "text-xs font-medium px-2.5 py-1 rounded-full transition-colors",
                    period === p
                      ? "bg-yes/15 text-yes"
                      : "text-dim hover:text-muted-custom"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Trade success toast overlay */}
            {tradeToast && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className={cn(
                  "flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl pointer-events-auto",
                  "animate-in fade-in zoom-in-95 duration-200",
                  tradeToast.side === "yes"
                    ? "bg-yes text-white"
                    : "bg-no text-white"
                )}>
                  <div className="shrink-0 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black text-base font-satoshi">
                    {tradeToast.side === "yes" ? "Y" : "N"}
                  </div>
                  <div>
                    <div className="text-sm font-black font-satoshi">{tradeToast.title}</div>
                    <div className="text-xs text-white/70 mt-0.5">{tradeToast.desc}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom action bar — 3D buttons with stepper */}
          <div className="shrink-0 px-4 pt-3 pb-4 pb-safe flex items-stretch gap-2">
            {/* Buy Yes — 3D button */}
            <button
              onClick={() => handleOneClickTrade("yes")}
              disabled={isTrading}
              className="flex-1 h-14 rounded-xl font-satoshi font-bold text-white bg-yes
                shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[2px] active:shadow-[0_2px_0_0px_rgba(15,60,140,0.9)]
                transition-all duration-75 disabled:opacity-50 disabled:pointer-events-none
                flex flex-col items-center justify-center"
            >
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/80 leading-none">Yes</span>
              <span className="text-lg font-black tabular-nums leading-tight">{yesPriceInt}%</span>
            </button>

            {/* Center stepper */}
            <div className="flex flex-col items-center justify-center gap-0.5 min-w-[72px] relative" ref={modeRef}>
              <button
                onClick={handleIncrement}
                className="text-muted-custom hover:text-text active:text-yes transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>

              <button
                onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
                className="flex flex-col items-center active:opacity-70 transition-opacity"
              >
                <span className="text-[15px] font-black font-satoshi tabular-nums text-text leading-tight">
                  {tradeInputMode === "usd" ? `$${tradeAmount}` : tradeAmount.toFixed(2)}
                </span>
                <span className="text-[8px] font-bold text-muted-custom uppercase flex items-center gap-0.5">
                  {tradeInputMode === "usd" ? "USD" : "Lots"}
                  <ChevronDown className="w-2 h-2" />
                </span>
              </button>

              <button
                onClick={handleDecrement}
                disabled={tradeInputMode === "usd" ? tradeAmount <= MIN_TRADE : tradeAmount <= 0.01}
                className="text-muted-custom hover:text-text active:text-yes transition-colors disabled:opacity-20"
              >
                <Minus className="w-4 h-4" />
              </button>

              {/* Mode dropdown popover */}
              {modeDropdownOpen && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[70] w-[200px]
                    bg-surface border border-border-custom rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.4)]
                    overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Mode switcher */}
                  <div className="flex border-b border-border-custom">
                    <button
                      onClick={() => handleSwitchMode("usd")}
                      className={cn(
                        "flex-1 text-center text-xs font-bold py-2.5 transition-colors",
                        tradeInputMode === "usd" ? "text-yes bg-yes/10" : "text-muted-custom hover:text-text"
                      )}
                    >
                      $ USD
                    </button>
                    <button
                      onClick={() => handleSwitchMode("lots")}
                      className={cn(
                        "flex-1 text-center text-xs font-bold py-2.5 transition-colors border-l border-border-custom",
                        tradeInputMode === "lots" ? "text-yes bg-yes/10" : "text-muted-custom hover:text-text"
                      )}
                    >
                      # Lots
                    </button>
                  </div>

                  {/* Custom amount input */}
                  <div className="px-3 pt-2.5 pb-2 relative">
                    {tradeInputMode === "usd" && (
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-custom pointer-events-none">$</span>
                    )}
                    <input
                      type="number"
                      inputMode="decimal"
                      value={tradeAmount}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0) setTradeAmount(val);
                      }}
                      className={cn(
                        "w-full bg-elevated border border-border-custom rounded-lg py-2",
                        "text-text text-sm font-black font-satoshi tabular-nums text-center",
                        "focus:outline-none focus:border-yes transition-colors",
                        tradeInputMode === "usd" ? "px-7" : "px-3"
                      )}
                      min={tradeInputMode === "usd" ? MIN_TRADE : 0.01}
                      step={tradeInputMode === "usd" ? 10 : 0.01}
                    />
                  </div>

                  {/* Quick-add presets */}
                  <div className="px-3 pb-2.5 flex gap-1.5">
                    {(tradeInputMode === "usd" ? [20, 50, 100] : [0.05, 0.1, 1]).map((val) => (
                      <button
                        key={val}
                        onClick={() => handleQuickAdd(val)}
                        className="flex-1 text-[10px] font-bold font-satoshi text-muted-custom hover:text-text
                          bg-elevated hover:bg-bg border border-border-custom rounded-lg px-1.5 py-2
                          transition-colors text-center active:bg-yes/20"
                      >
                        +{tradeInputMode === "usd" ? `$${val}` : val}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Buy No — 3D button */}
            <button
              onClick={() => handleOneClickTrade("no")}
              disabled={isTrading}
              className="flex-1 h-14 rounded-xl font-satoshi font-bold text-white bg-no
                shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[2px] active:shadow-[0_2px_0_0px_rgba(140,15,30,0.9)]
                transition-all duration-75 disabled:opacity-50 disabled:pointer-events-none
                flex flex-col items-center justify-center"
            >
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/80 leading-none">No</span>
              <span className="text-lg font-black tabular-nums leading-tight">{noPriceInt}%</span>
            </button>
          </div>

          {/* T&C Modal — first-time one-click trading */}
          {showTcModal && (
            <div className="fixed inset-0 z-[100]">
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => { setShowTcModal(false); setPendingTradeSide(null); }}
              />
              <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
                <div className="w-full max-w-[420px] animate-in fade-in zoom-in-95 duration-200">
                  <div className="bg-surface rounded-2xl p-8 shadow-[0_8px_32px_rgba(0,0,0,0.25)] relative">
                    <button
                      onClick={() => { setShowTcModal(false); setPendingTradeSide(null); }}
                      className="absolute top-4 right-4 text-muted-custom hover:text-text transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-elevated/50"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    <h2 className="text-lg font-black font-satoshi text-text mb-3">
                      {t("tcTitle")}
                    </h2>
                    <p className="text-sm text-muted-custom leading-relaxed mb-2">
                      {t("tcBody1")}
                    </p>
                    <ul className="text-sm text-muted-custom leading-relaxed mb-5 list-disc list-inside space-y-1">
                      <li>{t("tcPoint1")}</li>
                      <li>{t("tcPoint2")}</li>
                      <li>{t("tcPoint3")}</li>
                    </ul>

                    <button
                      onClick={handleAcceptTc}
                      className="w-full bg-yes text-white font-bold font-satoshi text-sm py-3 rounded-xl
                        hover:brightness-110 active:brightness-90 transition-all"
                    >
                      {t("tcAccept")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
