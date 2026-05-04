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
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  Share2,
  Plus,
  Minus,
  CandlestickChart,
  LineChart as LineChartIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
} from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import { useSpeedPositions } from "@/hooks/use-speed-positions";
import { useUser } from "@/lib/auth/hooks";
import {
  CASHOUT_REJECT_WINDOW_SECONDS,
  speedCashoutMultiplier,
  speedFairProbOver,
  speedLiqDiscount,
  speedOfferedProb,
  durationToSeconds,
} from "@/lib/speed/pricing";
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

const STAKE_CHIPS = [5, 10, 25, 50, 100];

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
          ${(balance ?? 0).toFixed(2)}
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
  const { cashout, loading } = useSpeedCashout();
  const fee = useSpeedFeeConfig();
  const pnlBus = usePnlPop();

  const stake = Number(pos.stake);
  const entryOfferedProb = Number(pos.entry_offered_prob);
  const isUp = pos.side === "over";

  // Match the SQL formula exactly (mig 0016 line 879-882):
  //   cashout = stake × (mark_prob / entry_offered) × decay × liq_discount
  // Same client mirror that speed-position-panel.tsx:74-81 uses; quote/
  // execute parity within ±$0.01 (mig 369 contract).
  const totalSeconds = durationToSeconds(market.duration);
  const closesAtMs = new Date(market.closes_at).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((closesAtMs - now) / 1000));
  const cashoutLocked = secondsLeft < CASHOUT_REJECT_WINDOW_SECONDS;

  const sigma = fee.realizedVol?.[market.asset]?.rv ?? fee.iv[market.asset] ?? 0.6;
  const fairOver =
    livePrice !== null && !isStale
      ? speedFairProbOver(livePrice, Number(market.strike_price), secondsLeft, sigma)
      : null;
  const markProb =
    fairOver !== null ? (isUp ? fairOver : 1 - fairOver) : null;
  const pct = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
  const decay = speedCashoutMultiplier(market.duration, pct, fee);
  const liq = speedLiqDiscount(secondsLeft);

  const cashoutValue =
    markProb !== null && decay !== null
      ? Math.max(0, Math.round(stake * (markProb / entryOfferedProb) * decay * liq * 100) / 100)
      : null;

  const handleCashout = useCallback(async () => {
    if (loading || cashoutLocked || cashoutValue === null) return;
    // Optimistic pop using the displayed value (within ±$0.01 of the RPC).
    // The actual realized PnL reconciles to the same animation either way.
    pnlBus?.pop(cashoutValue - stake);
    await cashout(pos.id, sigma);
  }, [loading, cashoutLocked, cashoutValue, pnlBus, stake, cashout, pos.id, sigma]);

  return (
    <button
      type="button"
      onClick={handleCashout}
      disabled={loading || cashoutLocked || cashoutValue === null}
      className={cn(
        "relative w-full h-14 rounded-2xl bg-text text-white overflow-hidden",
        "flex items-center justify-center text-center",
        "active:scale-[0.98] transition disabled:opacity-60",
      )}
      aria-label={`Cash out for ${cashoutValue !== null ? `$${cashoutValue.toFixed(2)}` : ""}`}
    >
      {/* 4px colored side bar — UP=success, DOWN=destructive. The only
          visual hint of which side this position bet on. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          isUp ? "bg-success" : "bg-destructive",
        )}
      />
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
    </button>
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
  const { placeBet, loading } = useSpeedExecuteTrade();
  const fee = useSpeedFeeConfig();
  const [stake, setStake] = useState(5);
  const [tapFire, setTapFire] = useState<SpeedSide | null>(null);

  const closesAt = new Date(market.closes_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((closesAt - Date.now()) / 1000));

  const strike = Number(market.strike_price);
  const sigma =
    fee.realizedVol?.[market.asset]?.rv ?? fee.iv[market.asset] ?? 0.6;
  const fairOver =
    livePrice !== null && !isStale
      ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
      : null;
  const offeredOver =
    fairOver !== null
      ? speedOfferedProb(
          fairOver,
          "over",
          fee.spread,
          fee.extremeSpreadCoeff,
          secondsLeft,
        )
      : null;
  const offeredUnder =
    fairOver !== null
      ? speedOfferedProb(
          fairOver,
          "under",
          fee.spread,
          fee.extremeSpreadCoeff,
          secondsLeft,
        )
      : null;

  const upMul = offeredOver ? 1 / offeredOver : null;
  const downMul = offeredUnder ? 1 / offeredUnder : null;
  // A6: total payout (stake + profit) the user receives on a winning bet.
  // Updates live as the user changes stake or as offered_prob ticks.
  const upPayout = upMul !== null ? stake * upMul : null;
  const downPayout = downMul !== null ? stake * downMul : null;

  const expired = secondsLeft <= 0 || market.status !== "open";
  const canBet =
    !expired && !isStale && fairOver !== null && stake > 0 && !loading;

  const handleBet = useCallback(
    async (side: SpeedSide) => {
      if (!canBet) return;
      setTapFire(side);
      setTimeout(() => setTapFire(null), 380);
      // B7: send the IV snapshot for quote/execute parity (mig 0016).
      await placeBet(market.id, side, stake, sigma);
    },
    [canBet, placeBet, market.id, stake, sigma],
  );

  return (
    <div
      className="mt-auto px-3 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]"
      role="region"
      aria-label="Speed trade dock"
    >
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
          disabled={!canBet}
          fired={tapFire === "over"}
        />
        <BetButton
          dir="under"
          payout={downPayout}
          onClick={() => handleBet("under")}
          disabled={!canBet}
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
        {payout !== null ? `$${payout.toFixed(2)}` : "—"}
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
