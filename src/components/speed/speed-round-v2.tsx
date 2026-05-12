"use client";

/**
 * Speed Round v2 — mobile-only single-screen layout for /speed/[id].
 *
 * Layout: Strip → PriceRow → ChartCard (existing project styling) →
 * PositionsStrip → Dock. Reuses the project's existing tokens
 * (`bg-bg`, `bg-surface`, `text-text`, `font-satoshi`, etc.) instead of
 * introducing beige + Geist — the visual rhythm matches the rest of the app.
 */

import { useEffect, useRef, useState, useMemo, useCallback, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  Share2,
  Plus,
  Minus,
  CandlestickChart,
  LineChart as LineChartIcon,
} from "lucide-react";
import { cn, formatCurrency, triggerHapticConfirm } from "@/lib/utils";
import {
  SpeedPriceChart,
  SPEED_CHART_TYPE_KEY,
  readSpeedChartType,
  type SpeedChartType,
} from "@/components/speed/speed-price-chart";
import { SpeedWindowPills } from "@/components/speed/speed-window-pills";
import {
  useSpeedExecuteTrade,
  useSpeedCashout,
  type CashoutParitySnapshot,
  type TradeParitySnapshot,
} from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import { useSpeedTradeQuote } from "@/hooks/use-speed-quote";
import { useSpeedPositions } from "@/hooks/use-speed-positions";
import { useUser } from "@/lib/auth/hooks";
import {
  CASHOUT_REJECT_WINDOW_SECONDS,
  formatSpeedCountdown,
  isUrgent,
  computeCashoutAmount,
  isCashoutRejectedNearDecided,
  isEntryRejectedNearDecided,
  speedCashoutMargin,
  speedFairProbOver,
  speedOfferedProb,
  speedSecondsLeftBucket,
  durationToSeconds,
} from "@/lib/speed/pricing";
import { mapSpeedRpcError } from "@/lib/speed/errors";
import { OdometerNumber } from "./odometer-number";
import type {
  SpeedMarket,
  SpeedPosition,
  SpeedSide,
} from "@/types/database";

// ── PnL pop bus ───────────────────────────────────────────────
// Lightweight context so the cashout button (deep in PositionsStrip) can
// trigger the chart-overlay pop animation rendered by ChartCard. Same
// component tree, no prop drilling.
interface PnlPopEvent {
  id: number;
  value: number;
  type: "win" | "loss";
}
const PnlPopContext = createContext<{
  pop: (value: number) => void;
} | null>(null);
function usePnlPop() {
  return useContext(PnlPopContext);
}

const STAKE_CHIPS = [10, 50, 100, 500, 1000];

interface Props {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
  onBack?: () => void;
  /**
   * Group D: true while the parent is polling for the next live market
   * (after the current one closed). ChartCard renders a small
   * "WAITING FOR NEXT ROUND" pill so the user knows the wait is intentional.
   */
  waitingForNext?: boolean;
}

export function SpeedRoundV2({
  market,
  livePrice,
  isStale,
  onBack,
  waitingForNext = false,
}: Props) {
  const router = useRouter();
  const { user } = useUser();
  const { positions: allOpen } = useSpeedPositions({ onlyOpen: true });
  const { positions: allPositions } = useSpeedPositions();
  const positions = useMemo(
    () => allOpen.filter((p) => p.market_id === market.id),
    [allOpen, market.id],
  );

  // Group D: chart P&L pop bus. Cashout button calls pop(realizedPnl);
  // ChartCard reads the latest event and renders the .speed-pnl-pop
  // overlay with the win/loss class. Events auto-clear after 1s.
  const [pnlEvent, setPnlEvent] = useState<PnlPopEvent | null>(null);
  const pop = useCallback((value: number) => {
    setPnlEvent({
      id: Date.now(),
      value,
      type: value >= 0 ? "win" : "loss",
    });
  }, []);
  useEffect(() => {
    if (!pnlEvent) return;
    const id = setTimeout(() => setPnlEvent(null), 1000);
    return () => clearTimeout(id);
  }, [pnlEvent]);

  // Settlement → chart pop. Watches every position the user owns (unfiltered
  // by market_id) and fires the in-chart pop the moment one transitions
  // open → won/lost. Unfiltered on purpose: by the time the resolve cron
  // settles the round and the 5s positions poll picks it up, the user has
  // already cross-faded to the next round via Effect B's redirect — so
  // filtering by `market.id` would miss the pop. Refunded settlements
  // stay silent (the global settlement-toaster also stays silent on those).
  // Detection mirrors SpeedSettlementToaster but routes the result into
  // the in-chart surface so the chart and the mid-screen pop fire as one
  // unified moment.
  const seenSettleStatusesRef = useRef<Map<string, string>>(new Map());
  const settleInitialisedRef = useRef(false);
  useEffect(() => {
    if (!allPositions) return;
    if (!settleInitialisedRef.current) {
      allPositions.forEach((p) => seenSettleStatusesRef.current.set(p.id, p.status));
      settleInitialisedRef.current = true;
      return;
    }
    for (const p of allPositions) {
      const prev = seenSettleStatusesRef.current.get(p.id);
      seenSettleStatusesRef.current.set(p.id, p.status);
      if (prev !== "open") continue;
      if (p.status === "won") {
        const stake = Number(p.stake);
        const payout = Number(p.payout_amount ?? 0);
        pop(Math.max(0, payout - stake));
      } else if (p.status === "lost") {
        pop(-Number(p.stake));
      }
      // refunded: silent — quiet refund, mirrors global toaster behavior
    }
  }, [allPositions, pop]);

  return (
    <PnlPopContext.Provider value={{ pop }}>
      <div className="speed-v2-root font-dm-sans bg-bg text-text min-h-screen flex flex-col">
        <Strip
          market={market}
          balance={user?.balance_usd ?? null}
          onBack={onBack ?? (() => router.back())}
        />
        <PriceRow market={market} livePrice={livePrice} />
        <ChartCard
          market={market}
          pnlEvent={pnlEvent}
          waitingForNext={waitingForNext}
        />
        <PositionsStrip
          positions={positions}
          livePrice={livePrice}
          market={market}
          isStale={isStale}
        />
        <Dock
          market={market}
          livePrice={livePrice}
          isStale={isStale}
          hasOpenPositions={positions.length > 0}
        />
      </div>
    </PnlPopContext.Provider>
  );
}

// ── Strip (chevron · title sub-row · balance · share) ─────────
function Strip({
  market,
  balance,
  onBack,
}: {
  market: SpeedMarket;
  balance: number | null;
  onBack: () => void;
}) {
  return (
    <div
      className="grid items-center gap-2.5 px-3 py-1.5"
      style={{ gridTemplateColumns: "36px 1fr auto 36px" }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full text-text active:bg-surface"
      >
        <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
      </button>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="font-satoshi text-sm font-bold tracking-[-0.015em] text-text">
          Bitcoin{" "}
          <span className="font-medium text-muted-custom">· BTC/USDT</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.06em] text-muted-custom mt-[3px] flex items-center gap-1.5 tabular-nums">
          <span
            className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
            aria-hidden
          />
          Round · {market.duration}
        </span>
      </div>
      {/* Balance moved here from price row — prominent at top-right */}
      <div className="flex flex-col items-end gap-[2px] pr-1">
        <span className="font-satoshi text-[17px] font-bold tabular-nums leading-none tracking-[-0.03em] text-text">
          {formatCurrency(balance ?? 0)}
        </span>
        <span className="text-[9px] uppercase tracking-[0.08em] text-muted-custom font-medium">
          Bal
        </span>
      </div>
      <button
        type="button"
        aria-label="Share"
        className="flex h-9 w-9 items-center justify-center rounded-full text-text active:bg-surface"
      >
        <Share2 className="h-4 w-4" strokeWidth={1.6} />
      </button>
    </div>
  );
}

// ── PriceRow (live price · timer big on right · flicker on tick) ─
function PriceRow({
  market,
  livePrice,
}: {
  market: SpeedMarket;
  livePrice: number | null;
}) {
  // Timer state — was previously in Strip; lives here now next to the price.
  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const warn = secondsLeft < 30;

  // Flicker on tick: track previous price; when it changes, flash green
  // (up) or red (down) for 350ms then return to neutral. Gives a visible
  // sense of live movement without animating every digit.
  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (livePrice === null) return;
    const prev = prevPriceRef.current;
    if (prev !== null && livePrice !== prev) {
      setFlash(livePrice > prev ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 350);
      return () => clearTimeout(t);
    }
    prevPriceRef.current = livePrice;
  }, [livePrice]);
  // Update the ref AFTER each render so the next tick has a true previous
  // value. Doing this inside the effect would clobber the comparison.
  useEffect(() => {
    prevPriceRef.current = livePrice;
  });

  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 pt-1 pb-2.5">
      <div
        className={cn(
          "transition-colors duration-300",
          flash === "up" && "text-success",
          flash === "down" && "text-destructive",
          !flash && "text-text",
        )}
      >
        {livePrice !== null ? (
          <OdometerNumber
            value={livePrice}
            prefix="$"
            className="font-satoshi text-[30px] font-black tabular-nums tracking-[-0.035em] leading-none"
          />
        ) : (
          <span className="font-satoshi text-[30px] font-black tabular-nums tracking-[-0.035em] leading-none text-muted-custom">
            $—
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-[2px] shrink-0">
        <span
          className={cn(
            "font-satoshi text-[28px] font-black tabular-nums leading-none tracking-[-0.035em]",
            warn ? "text-destructive" : "text-text",
          )}
        >
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
        <span className="text-[9px] uppercase tracking-[0.08em] text-muted-custom font-medium">
          Ends in
        </span>
      </div>
    </div>
  );
}

// ── ChartCard (project-native: grid-dots + border + chart-type toggle) ─
function ChartCard({
  market,
  pnlEvent,
  waitingForNext,
}: {
  market: SpeedMarket;
  pnlEvent: PnlPopEvent | null;
  waitingForNext: boolean;
}) {
  const [chartType, setChartType] = useState<SpeedChartType>(readSpeedChartType);
  const handleChartType = (next: SpeedChartType) => {
    setChartType(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SPEED_CHART_TYPE_KEY, next);
      }
    } catch {
      // private mode
    }
  };

  return (
    <div className="px-3 flex-1 min-h-0 flex flex-col gap-2">
      {/* Chart card — project's existing grid-dots + border styling.
          Past dropdown floats top-left, chart-type toggle floats bottom-right
          inside the card. PnL pop overlays at the center on cashout. */}
      <div className="relative grid-dots rounded-xl border border-border-custom p-3 flex-1 min-h-[260px] flex flex-col overflow-hidden">
        <SpeedPriceChart
          asset={market.asset}
          strikePrice={Number(market.strike_price)}
          opensAt={market.opens_at}
          closesAt={market.closes_at}
          duration={market.duration}
          height={260}
          chartType={chartType}
          className="!h-full flex-1"
        />
        {/* P&L pop overlay — fires on user-initiated cashout (Group D). The
            `key={pnlEvent.id}` retriggers the CSS keyframe each event. */}
        {pnlEvent && (
          <div
            key={pnlEvent.id}
            className={cn("speed-pnl-pop", pnlEvent.type)}
            aria-hidden
          >
            {pnlEvent.value >= 0 ? "+" : "−"}$
            {Math.abs(pnlEvent.value).toFixed(2)}
          </div>
        )}
        {/* Group D: brief "WAITING FOR NEXT ROUND" pill while the parent
            polls for the next live market. Sits dead-center so it reads as
            an intentional pause, not a stuck state. */}
        {waitingForNext && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center"
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-bg/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-custom ring-1 ring-border-custom backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Waiting for next round
            </span>
          </div>
        )}
        {/* Past dropdown: long-thin rectangle in the top-left corner */}
        <div className="pointer-events-none absolute top-2 left-2 z-10">
          <div className="pointer-events-auto">
            <SpeedWindowPills
              asset={market.asset}
              duration={market.duration}
              currentId={market.id}
            />
          </div>
        </div>
        {/* Floating chart-type toggle: small round icons inside the card */}
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
          <button
            type="button"
            aria-label="Candlestick view"
            aria-pressed={chartType === "candle"}
            onClick={() => handleChartType("candle")}
            className={cn(
              "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors shrink-0 backdrop-blur-sm ring-1 ring-border-custom",
              chartType === "candle"
                ? "bg-text text-bg"
                : "bg-surface/80 text-muted-custom hover:text-text hover:bg-bg",
            )}
          >
            <CandlestickChart className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="Line view"
            aria-pressed={chartType === "line"}
            onClick={() => handleChartType("line")}
            className={cn(
              "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors shrink-0 backdrop-blur-sm ring-1 ring-border-custom",
              chartType === "line"
                ? "bg-text text-bg"
                : "bg-surface/80 text-muted-custom hover:text-text hover:bg-bg",
            )}
          >
            <LineChartIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PositionsStrip ────────────────────────────────────────────
function PositionsStrip({
  positions,
  livePrice,
  market,
  isStale,
}: {
  positions: SpeedPosition[];
  livePrice: number | null;
  market: SpeedMarket;
  isStale: boolean;
}) {
  if (positions.length === 0) {
    return (
      <div className="pt-2">
        <div className="text-center text-[10.5px] uppercase tracking-[0.06em] text-muted-custom py-1.5 font-medium">
          No open trades
        </div>
      </div>
    );
  }
  // Group D: AnimatePresence wraps the cards so newly-placed positions
  // spring in from below and cashed-out / settled ones fade out cleanly.
  return (
    <div className="px-3 pt-2 max-h-[150px] overflow-y-auto flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {positions.map((p) => (
          <motion.div
            key={p.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <PositionCard
              pos={p}
              livePrice={livePrice}
              market={market}
              isStale={isStale}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function PositionCard({
  pos,
  livePrice,
  market,
  isStale,
}: {
  pos: SpeedPosition;
  livePrice: number | null;
  market: SpeedMarket;
  isStale: boolean;
}) {
  const t = useTranslations("speed");
  // Phase 5b (2026-05-12): destructure `error` so server rejections surface
  // visibly. Before this change the cashout button silently swallowed every
  // server error (rate limit, parity drift, balance, cap, etc.).
  const { cashout, loading, error: cashError } = useSpeedCashout();
  const fee = useSpeedFeeConfig();
  const pnlBus = usePnlPop();

  const stake = Number(pos.stake);
  const entryOfferedProb = Number(pos.entry_offered_prob);
  const isUp = pos.side === "over";

  // Mig 0028+: option-C profit-based cashout. Direction-matching invariant
  // by construction (winning ⇒ cashout > stake). Quote/execute parity via
  // mig 0030 expected_* params (sent below).
  const totalSeconds = durationToSeconds(market.duration);
  const closesAtMs = new Date(market.closes_at).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((closesAtMs - now) / 1000));
  const lateRejectS = fee.pricing.cashoutLateRejectS ?? CASHOUT_REJECT_WINDOW_SECONDS;
  const cashoutLockedLate = secondsLeft < lateRejectS;
  const urgent = isUrgent(totalSeconds, secondsLeft);

  const sigma = fee.realizedVol?.[market.asset]?.rv ?? fee.iv[market.asset] ?? 0.6;
  // Phase 5b (2026-05-12): removed `&& !isStale` silent gate. We still compute
  // a markProb even if the WS is briefly stale — the chart is showing the
  // last known price; the cashout button should honor that. Server has its
  // own authoritative 2s staleness check on speed_oracle_latest. If truly
  // stale, server rejects with a visible error (now rendered via cashError).
  const fairOver =
    livePrice !== null
      ? speedFairProbOver(livePrice, Number(market.strike_price), secondsLeft, sigma)
      : null;
  const markProb =
    fairOver !== null ? (isUp ? fairOver : 1 - fairOver) : null;

  let cashoutValue: number | null = null;
  if (markProb !== null) {
    const isWinning = markProb >= entryOfferedProb;
    const margin = speedCashoutMargin(market.duration, isWinning, markProb, secondsLeft, fee);
    const raw = computeCashoutAmount(stake, entryOfferedProb, markProb, isWinning, margin);
    cashoutValue = Math.max(0, Math.round(raw * 100) / 100);
  }

  const cashoutLockedNearDecided =
    markProb !== null && isCashoutRejectedNearDecided(markProb, secondsLeft, fee);
  const cashoutLocked = cashoutLockedLate || cashoutLockedNearDecided;

  const delta = cashoutValue !== null ? cashoutValue - stake : null;
  const potentialPayout = entryOfferedProb > 0 ? stake / entryOfferedProb : null;

  const handleCashout = useCallback(async () => {
    if (loading || cashoutLocked || cashoutValue === null) return;
    triggerHapticConfirm();
    pnlBus?.pop(cashoutValue - stake);
    // Hot-fix: align with mig 0057 follow-up. The other cashout call sites
    // (speed-mobile-trade-bar, speed-position-panel) only send spot + bucket
    // because expectedIv / expectedMarkProb / expectedCashoutAmount were
    // tripping PARITY_DRIFT silently on deep-losing $0.00 cashouts —
    // _speed_assert_parity raises when actual=0, regardless of whether
    // expected was also 0. Server-side fix is a separate concern; for now
    // skip these client-supplied parity fields to match the rest of the
    // codebase. Server has its own authoritative computation.
    const parity: CashoutParitySnapshot = {
      expectedSpot: livePrice ?? undefined,
      expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
    };
    // Plan E: pass marketId so the cashout hook can flip the correct
    // (userId, marketId)-scoped query keys for instant UI update.
    await cashout(pos.id, parity, undefined, pos.market_id);
  }, [loading, cashoutLocked, cashoutValue, pnlBus, stake, cashout, pos.id, pos.market_id, livePrice, secondsLeft]);

  // Phase 5b (2026-05-12): surface server errors that previously disappeared
  // into hook state. Same mapping pattern as Phase 1 mobile-bar fix.
  const mappedError = cashError ? mapSpeedRpcError(cashError) : null;

  // 0062 Phase 5e: on 1m markets, cashout is structurally unavailable (the
  // longshot-extract exploit lives here). Render a passive position monitor
  // instead of a cashout button. No tap target, no "WIN PAYOUT" label, no
  // disabled-button styling — just a clean info card showing what the user
  // has and what it could be at settlement.
  if (market.duration === "1m") {
    return (
      <div
        className={cn(
          "relative w-full rounded-lg bg-bg ring-1 ring-border-custom/50 overflow-hidden px-4 py-2.5 text-left cursor-default select-text",
        )}
        role="region"
        aria-label={`Position: ${isUp ? "up" : "down"} ${formatCurrency(stake)}`}
      >
        {/* 4px colored side bar — direction is the one thing we want
            unmistakable. No button affordance otherwise. */}
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1",
            isUp ? "bg-success" : "bg-destructive",
          )}
        />

        {/* Row 1: side chip + countdown · stake reference. */}
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 leading-none",
                isUp ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive",
              )}
            >
              {isUp ? t("up") : t("down")}
            </span>
            <span
              className={cn(
                "tabular-nums text-muted-custom",
                urgent && "animate-pulse text-destructive",
              )}
            >
              {formatSpeedCountdown(secondsLeft)}
            </span>
          </div>
          <span className="tabular-nums text-muted-custom">
            {formatCurrency(stake)} {t("stake")}
          </span>
        </div>

        {/* Row 2: position recap — side+stake. Info weight, not button. */}
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-custom">
            {t("yourPosition")}
          </span>
          <span className="font-satoshi text-base font-bold tabular-nums tracking-[-0.01em] leading-none text-text">
            {isUp ? t("up") : t("down")} {formatCurrency(stake)}
          </span>
        </div>

        {/* Row 3: settlement potential — "Pays $X if you win" */}
        <div className="mt-0.5 flex items-center justify-end h-4 text-xs font-bold tabular-nums leading-none">
          {potentialPayout !== null && (
            <span className="font-satoshi text-muted-custom uppercase tracking-wide text-[10px]">
              {t("paysIfWin", { amount: formatCurrency(potentialPayout) })}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Error toast: visible whenever a cashout returned a server error.
          Replaces the prior silent failure where the panel stayed unchanged
          after a failed tap. */}
      {mappedError && (
        <div
          className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive ring-1 ring-destructive/30"
          role="alert"
        >
          {mappedError.userMessage}
        </div>
      )}
      {/* Reconnecting hint when WS is briefly stale but we still have a price.
          Informational only — the button stays enabled because the server
          has its own authoritative 2s staleness check. */}
      {isStale && livePrice !== null && !mappedError && (
        <div className="text-[10px] uppercase tracking-wide text-muted-custom text-center font-medium">
          Reconnecting to live price…
        </div>
      )}
    <button
      type="button"
      onClick={handleCashout}
      disabled={loading || cashoutLocked || cashoutValue === null}
      className={cn(
        "relative w-full rounded-2xl bg-text text-bg overflow-hidden px-4 py-2.5 text-left",
        "active:scale-[0.98] transition disabled:opacity-60",
      )}
      aria-label={`Cash out for ${cashoutValue !== null ? formatCurrency(cashoutValue) : ""}`}
    >
      {/* 4px colored side bar — UP=success, DOWN=destructive. Visual
          double-redundancy with the side chip in row 1. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          isUp ? "bg-success" : "bg-destructive",
        )}
      />

      {/* Row 1: side chip + countdown · stake reference. Tokens use
          `text-bg` (inverse of `bg-text`) so they read in both themes. */}
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 leading-none",
              isUp ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive",
            )}
          >
            {isUp ? t("up") : t("down")}
          </span>
          <span
            className={cn(
              "tabular-nums text-bg/70",
              urgent && "animate-pulse text-destructive",
            )}
          >
            {formatSpeedCountdown(secondsLeft)}
          </span>
        </div>
        <span className="tabular-nums text-bg/55">
          {formatCurrency(stake)} {t("stake")}
        </span>
      </div>

      {/* Row 2: label + amount */}
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-bg/70">
          {loading ? "…" : cashoutLocked ? t("closing") : t("cashOut")}
        </span>
        {cashoutValue !== null ? (
          <OdometerNumber
            value={cashoutValue}
            decimals={2}
            prefix="$"
            duration={0.3}
            className="font-satoshi text-2xl font-black tabular-nums tracking-[-0.01em] leading-none"
          />
        ) : (
          <span className="font-satoshi text-2xl font-black tabular-nums tracking-[-0.01em] leading-none">
            —
          </span>
        )}
      </div>

      {/* Row 3: live P/L delta on the left, settlement payout on the right
          so the user can compare "take $X now" vs "hold to win $Y". */}
      <div className="mt-0.5 flex items-center justify-between h-4 text-xs font-bold tabular-nums leading-none">
        {delta !== null ? (
          <span
            className={cn(
              "font-satoshi",
              delta > 0.005
                ? "text-success"
                : delta < -0.005
                  ? "text-destructive"
                  : "text-bg/55",
            )}
          >
            {delta > 0.005 ? "+" : ""}
            {formatCurrency(delta)}
          </span>
        ) : (
          <span />
        )}
        {potentialPayout !== null && (
          <span className="font-satoshi text-bg/60 uppercase tracking-wide text-[10px]">
            {isUp ? t("over") : t("under")} {t("strike")} {formatCurrency(potentialPayout)}
          </span>
        )}
      </div>
    </button>
    </div>
  );
}

// ── Dock ──────────────────────────────────────────────────────
function Dock({
  market,
  livePrice,
  isStale,
  hasOpenPositions,
}: {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
  hasOpenPositions: boolean;
}) {
  // Phase 5b (2026-05-12): destructure `error` so trade-entry rejections
  // surface visibly. Mirrors the cashout-side fix in PositionCard.
  const { placeBet, loading, error: betError } = useSpeedExecuteTrade();
  const fee = useSpeedFeeConfig();
  const [stake, setStake] = useState(5);
  const [tapFire, setTapFire] = useState<SpeedSide | null>(null);

  const closesAt = new Date(market.closes_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((closesAt - Date.now()) / 1000));

  const strike = Number(market.strike_price);
  const sigma =
    fee.realizedVol?.[market.asset]?.rv ?? fee.iv[market.asset] ?? 0.6;
  // T3.1: gate Dock bet buttons on RV snapshot being loaded.
  const rvLoaded = !fee.useRealizedVol || Boolean(fee.realizedVol?.[market.asset]);

  const expired = secondsLeft <= 0 || market.status !== "open";

  // Mig 0034+0044 follow-up: server-authoritative quotes for both sides.
  // The Dock bet buttons display payout multipliers that need to match
  // what the trade RPC will actually execute at. See use-speed-quote.ts.
  //
  // Phase 5b (2026-05-12): removed `!isStale` from quoteEnabled. We still
  // poll for quotes during brief WS hiccups; the server is authoritative
  // on staleness and will reject visibly if the oracle is truly stale.
  const quoteEnabled = !expired && market.status === "open";
  const { quote: overQuote } = useSpeedTradeQuote(market.id, "over", {
    enabled: quoteEnabled,
  });
  const { quote: underQuote } = useSpeedTradeQuote(market.id, "under", {
    enabled: quoteEnabled,
  });

  // Local fallback while quote loads or for anon users.
  // Phase 5b: removed `&& !isStale` silent gate. Same reasoning as
  // PositionCard.fairOver: server checks staleness authoritatively.
  const localFairOver =
    livePrice !== null
      ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
      : null;
  const localOfferedOver =
    localFairOver !== null
      ? speedOfferedProb(localFairOver, "over", fee, secondsLeft)
      : null;
  const localOfferedUnder =
    localFairOver !== null
      ? speedOfferedProb(localFairOver, "under", fee, secondsLeft)
      : null;

  const offeredOver = overQuote?.offered_prob ?? localOfferedOver;
  const offeredUnder = underQuote?.offered_prob ?? localOfferedUnder;
  const fairOver = overQuote?.fair_prob_side ?? localFairOver;

  const upMul = offeredOver ? 1 / offeredOver : null;
  const downMul = offeredUnder ? 1 / offeredUnder : null;
  // A6: total payout (stake + profit) the user receives on a winning bet.
  // Updates live as the user changes stake or as offered_prob ticks.
  const upPayout = upMul !== null ? stake * upMul : null;
  const downPayout = downMul !== null ? stake * downMul : null;

  // Mig 0028: entry-side gating predicates mirrored on client. Prefer
  // server booleans from the quote when available.
  const upBlocked =
    overQuote?.near_decided_block ??
    overQuote?.soft_blocked ??
    (fairOver !== null
      ? isEntryRejectedNearDecided(fairOver, secondsLeft, fee)
      : false);
  const downBlocked =
    underQuote?.near_decided_block ??
    underQuote?.soft_blocked ??
    (fairOver !== null
      ? isEntryRejectedNearDecided(1 - fairOver, secondsLeft, fee)
      : false);
  // Phase 5b (2026-05-12): removed `!isStale` silent gate. The button stays
  // enabled when WS is briefly stale — server has its own 2s authoritative
  // check and will reject with a visible error if the price is truly stale.
  const canBetOver =
    !expired && fairOver !== null && stake > 0 && !loading && !upBlocked && rvLoaded;
  const canBetUnder =
    !expired && fairOver !== null && stake > 0 && !loading && !downBlocked && rvLoaded;

  const handleBet = useCallback(
    async (side: SpeedSide) => {
      const allowed = side === "over" ? canBetOver : canBetUnder;
      if (!allowed) return;
      triggerHapticConfirm();
      setTapFire(side);
      setTimeout(() => setTapFire(null), 380);
      // Mig 0030 / 0057 follow-up: only echo client-truthful inputs (spot,
      // bucket). IV / fair_prob / offered_prob are computed from globals
      // on the client but per-market on the server (mig 0049-0051) so they
      // diverged silently. Server treats NULL as skip. See speed-trade-panel.tsx.
      const parity: TradeParitySnapshot = {
        expectedSpot: livePrice ?? undefined,
        expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
      };
      await placeBet(market.id, side, stake, parity);
    },
    [canBetOver, canBetUnder, placeBet, market.id, stake, livePrice, secondsLeft],
  );

  // Phase 5b (2026-05-12): surface server errors that previously vanished.
  const mappedError = betError ? mapSpeedRpcError(betError) : null;

  return (
    <div
      className="mt-auto px-3 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]"
      role="region"
      aria-label="Speed trade dock"
    >
      {/* Error toast for trade rejections (rate limit, parity drift, balance,
          cap reached, etc.). Phase 5b — replaces the prior silent failure. */}
      {mappedError && (
        <div
          className="mb-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive ring-1 ring-destructive/30"
          role="alert"
        >
          {mappedError.userMessage}
        </div>
      )}
      {/* Reconnecting hint when WS is briefly stale. Button stays enabled. */}
      {isStale && livePrice !== null && !mappedError && (
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-custom text-center font-medium">
          Reconnecting to live price…
        </div>
      )}
      {/* A5: hide preset chips when the user has at least one open position
          on this market — the dock stays leaner and attention shifts to
          the live position card above. */}
      {!hasOpenPositions && (
        <div className="grid grid-cols-5 gap-1.5 mb-2.5">
          {STAKE_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setStake(v)}
              className={cn(
                "h-8 rounded-lg border text-xs font-bold tabular-nums transition-all active:scale-[0.96]",
                stake === v
                  ? "bg-text text-bg border-text"
                  : "bg-surface text-muted-custom border-border-custom",
              )}
            >
              ${v}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-stretch gap-1.5 mb-2.5">
        <button
          type="button"
          onClick={() => setStake((s) => Math.max(1, s - 1))}
          className="h-11 w-11 rounded-xl border border-border-custom bg-surface text-text flex items-center justify-center active:scale-[0.92]"
          aria-label="Decrease stake"
        >
          <Minus className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <div className="flex-1 h-11 rounded-xl border border-border-custom bg-surface flex items-center justify-center font-satoshi text-xl font-black tabular-nums tracking-[-0.02em] text-text">
          <span className="text-muted-custom mr-0.5 font-medium">$</span>
          {stake}
        </div>
        <button
          type="button"
          onClick={() => setStake((s) => s + 1)}
          className="h-11 w-11 rounded-xl border border-border-custom bg-surface text-text flex items-center justify-center active:scale-[0.92]"
          aria-label="Increase stake"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <BetButton
          dir="over"
          payout={upPayout}
          onClick={() => handleBet("over")}
          disabled={!canBetOver}
          fired={tapFire === "over"}
        />
        <BetButton
          dir="under"
          payout={downPayout}
          onClick={() => handleBet("under")}
          disabled={!canBetUnder}
          fired={tapFire === "under"}
        />
      </div>
    </div>
  );
}

function BetButton({
  dir,
  payout,
  onClick,
  disabled,
  fired,
}: {
  dir: SpeedSide;
  payout: number | null;
  onClick: () => void;
  disabled: boolean;
  fired: boolean;
}) {
  const isUp = dir === "over";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // 3D press effect — same chunky vertical drop-shadow + active
        // translate that the prediction-market HeroMarketCard / SpeedHeroCard
        // use, so the press feel stays consistent across the app.
        // A7+A8: ×mult badge and TrendingUp/Down icons removed —
        // color + label + payout amount communicate everything needed.
        "relative h-20 rounded-lg flex flex-col items-center justify-center gap-1 text-white overflow-hidden transition-all duration-[80ms] disabled:opacity-60 [-webkit-tap-highlight-color:transparent] font-satoshi font-black",
        isUp
          ? "bg-success shadow-[0_4px_0_0px_rgba(20,90,60,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(20,90,60,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(20,90,60,0.9)]"
          : "bg-destructive shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]",
      )}
    >
      <span className="text-[15px] font-black tracking-[0.04em] uppercase leading-none">
        {isUp ? "Up" : "Down"}
      </span>
      {/* A6: total payout (stake + profit) instead of marginal profit. */}
      <span className="text-[14px] font-black tabular-nums leading-none">
        {payout !== null ? formatCurrency(payout) : "—"}
      </span>
      {fired && (
        <span
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ animation: "speedV2TapFire 0.35s ease-out" }}
          aria-hidden
        />
      )}
      <style jsx>{`
        @keyframes speedV2TapFire {
          0% { box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0.35); }
          100% { box-shadow: inset 0 0 0 22px rgba(255, 255, 255, 0); }
        }
      `}</style>
    </button>
  );
}
