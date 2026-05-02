"use client";

/**
 * Speed Round v2 — mobile-only single-screen layout for /speed/[id].
 *
 * Layout: Strip → PriceRow → ChartCard (existing project styling) →
 * PositionsStrip → Dock. Reuses the project's existing tokens
 * (`bg-bg`, `bg-surface`, `text-text`, `font-satoshi`, etc.) instead of
 * introducing beige + Geist — the visual rhythm matches the rest of the app.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Share2,
  Plus,
  Minus,
  TrendingUp,
  TrendingDown,
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
  speedFairProbOver,
  speedOfferedProb,
} from "@/lib/speed/pricing";
import { OdometerNumber } from "./odometer-number";
import type {
  SpeedMarket,
  SpeedPosition,
  SpeedSide,
} from "@/types/database";

const STAKE_CHIPS = [5, 10, 25, 50, 100];

interface Props {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
  onBack?: () => void;
}

export function SpeedRoundV2({ market, livePrice, isStale, onBack }: Props) {
  const router = useRouter();
  const { user } = useUser();
  const { positions: allOpen } = useSpeedPositions({ onlyOpen: true });
  const positions = useMemo(
    () => allOpen.filter((p) => p.market_id === market.id),
    [allOpen, market.id],
  );

  return (
    <div className="speed-v2-root font-dm-sans bg-bg text-text min-h-screen flex flex-col">
      <Strip
        market={market}
        balance={user?.balance_usd ?? null}
        onBack={onBack ?? (() => router.back())}
      />
      <PriceRow market={market} livePrice={livePrice} />
      <ChartCard market={market} />
      <PositionsStrip positions={positions} livePrice={livePrice} />
      <Dock market={market} livePrice={livePrice} isStale={isStale} />
    </div>
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
function ChartCard({ market }: { market: SpeedMarket }) {
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
      {/* Chart card — project's existing grid-dots + border styling */}
      <div className="grid-dots rounded-xl border border-border-custom p-3 flex-1 min-h-[260px] flex flex-col">
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
      </div>
      {/* Pills row: Past dropdown + Live pill on left, chart-type toggle on right.
          Same component + visual rhythm as the existing /speed/[id] desktop. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SpeedWindowPills
            asset={market.asset}
            duration={market.duration}
            currentId={market.id}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Candlestick view"
            aria-pressed={chartType === "candle"}
            onClick={() => handleChartType("candle")}
            className={cn(
              "inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors shrink-0",
              chartType === "candle"
                ? "bg-text text-bg"
                : "bg-surface text-muted-custom hover:text-text hover:bg-bg",
            )}
          >
            <CandlestickChart className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="Line view"
            aria-pressed={chartType === "line"}
            onClick={() => handleChartType("line")}
            className={cn(
              "inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors shrink-0",
              chartType === "line"
                ? "bg-text text-bg"
                : "bg-surface text-muted-custom hover:text-text hover:bg-bg",
            )}
          >
            <LineChartIcon className="h-4 w-4" strokeWidth={2.25} />
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
}: {
  positions: SpeedPosition[];
  livePrice: number | null;
}) {
  if (positions.length === 0) {
    return (
      <div className="px-3 pt-2">
        <div className="text-[10.5px] uppercase tracking-[0.06em] text-muted-custom py-1.5 font-medium">
          No open trades
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 pt-2 max-h-[150px] overflow-y-auto flex flex-col gap-1.5">
      {positions.map((p) => (
        <PositionCard key={p.id} pos={p} livePrice={livePrice} />
      ))}
    </div>
  );
}

function PositionCard({
  pos,
  livePrice,
}: {
  pos: SpeedPosition;
  livePrice: number | null;
}) {
  const { cashout, loading } = useSpeedCashout();
  const stake = Number(pos.stake);
  const entry = Number(pos.entry_price);
  const isUp = pos.side === "over";
  const moved =
    livePrice !== null ? (isUp ? livePrice - entry : entry - livePrice) : 0;
  const ratio = Math.max(-0.85, Math.min(2.0, moved / 30));
  const pnl = stake * ratio;
  const isWin = pnl >= 0;
  const ageS = Math.floor(
    (Date.now() - new Date(pos.created_at).getTime()) / 1000,
  );
  const payout = stake + pnl;
  const mult = 1 / Number(pos.entry_offered_prob);

  return (
    <div
      className="grid items-stretch overflow-hidden rounded-[10px] border border-border-custom bg-surface"
      style={{ gridTemplateColumns: "4px 1fr auto" }}
    >
      <div
        className={cn(
          "self-stretch",
          isUp ? "bg-success" : "bg-destructive",
        )}
        aria-hidden
      />
      <div className="px-2.5 py-2 flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span
            className={cn(
              "text-[10px] font-bold tracking-[0.08em] uppercase px-1 py-px rounded",
              isUp
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {isUp ? "Up" : "Down"}
          </span>
          <span className="font-bold text-text">${stake}</span>
          <span className="text-muted-custom">×{mult.toFixed(2)}</span>
          <span className="ml-auto text-[10.5px] text-muted-custom">
            {ageS}s
          </span>
        </div>
        <div className="text-[10.5px] tabular-nums text-muted-custom flex items-center gap-1.5">
          <span>
            ${entry.toFixed(2)} → ${(livePrice ?? entry).toFixed(2)}
          </span>
          <span
            className={cn(
              "font-bold",
              isWin ? "text-success" : "text-destructive",
            )}
          >
            {isWin ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => cashout(pos.id)}
        disabled={loading}
        className={cn(
          "px-4 self-stretch flex flex-col items-end justify-center min-w-[110px] text-white text-right active:scale-[0.98] transition disabled:opacity-60",
          isWin ? "bg-success" : "bg-text",
        )}
      >
        <span className="text-[9px] font-bold tracking-[0.08em] uppercase opacity-70 mb-0.5">
          Cash out
        </span>
        <span className="font-satoshi text-base font-black tabular-nums tracking-[-0.01em] leading-none">
          ${payout.toFixed(2)}
        </span>
      </button>
    </div>
  );
}

// ── Dock ──────────────────────────────────────────────────────
function Dock({
  market,
  livePrice,
  isStale,
}: {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
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
  // Profit if the market expires in the user's favor (in dollars). Uses
  // the current stake input — updates live as the user changes stake or
  // as offered_prob ticks.
  const upProfit = upMul !== null ? stake * upMul - stake : null;
  const downProfit = downMul !== null ? stake * downMul - stake : null;

  const expired = secondsLeft <= 0 || market.status !== "open";
  const canBet =
    !expired && !isStale && fairOver !== null && stake > 0 && !loading;

  const handleBet = useCallback(
    async (side: SpeedSide) => {
      if (!canBet) return;
      setTapFire(side);
      setTimeout(() => setTapFire(null), 380);
      await placeBet(market.id, side, stake);
    },
    [canBet, placeBet, market.id, stake],
  );

  return (
    <div
      className="mt-auto px-3 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))]"
      role="region"
      aria-label="Speed trade dock"
    >
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
          mult={upMul}
          profit={upProfit}
          onClick={() => handleBet("over")}
          disabled={!canBet}
          fired={tapFire === "over"}
        />
        <BetButton
          dir="under"
          mult={downMul}
          profit={downProfit}
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
  mult,
  profit,
  onClick,
  disabled,
  fired,
}: {
  dir: SpeedSide;
  mult: number | null;
  profit: number | null;
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
        "relative h-20 rounded-lg flex flex-col items-center justify-center gap-1 text-white overflow-hidden transition-all duration-[80ms] disabled:opacity-60 [-webkit-tap-highlight-color:transparent] font-satoshi font-black",
        isUp
          ? "bg-success shadow-[0_4px_0_0px_rgba(20,90,60,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(20,90,60,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(20,90,60,0.9)]"
          : "bg-destructive shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]",
      )}
    >
      <span className="absolute top-1.5 right-2 px-1.5 py-px rounded text-[10px] font-bold tabular-nums bg-black/[0.22]">
        <span className="text-[9px] opacity-70 mr-px">×</span>
        {mult !== null ? mult.toFixed(2) : "—"}
      </span>
      <div className="flex items-center gap-2">
        {isUp ? (
          <TrendingUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
        ) : (
          <TrendingDown className="h-[18px] w-[18px]" strokeWidth={2.4} />
        )}
        <span className="text-[15px] font-black tracking-[0.04em] uppercase leading-none">
          {isUp ? "Up" : "Down"}
        </span>
      </div>
      <span className="text-[12px] font-bold tabular-nums opacity-90 leading-none">
        {profit !== null ? `+$${profit.toFixed(2)}` : "—"}
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
