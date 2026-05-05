"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, triggerHapticConfirm } from "@/lib/utils";
import {
  CASHOUT_REJECT_WINDOW_SECONDS,
  durationToSeconds,
  speedCashoutMultiplier,
  speedFairProbOver,
  speedLiqDiscount,
  speedOfferedProb,
} from "@/lib/speed/pricing";
import { useSpeedExecuteTrade, useSpeedCashout } from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import type { SpeedMarket, SpeedPosition, SpeedSide } from "@/types/database";

const STAKE_PRESETS = [10, 50, 100, 1000];

/**
 * Fixed-bottom mobile trade bar for /speed/[id].
 *
 * Two states based on whether the user has an open position:
 *
 *   No position:
 *   ┌────────────────────────────────────────────────┐
 *   │       [ − ]   $5   [ + ]                       │  stake stepper
 *   │   [  UP 51% +$4.80  ]  [  DOWN 49% +$5.10  ]   │  one-click bets
 *   └────────────────────────────────────────────────┘
 *
 *   Open position:
 *   ┌────────────────────────────────────────────────┐
 *   │            [   CASH OUT  ·  $14.43   ]         │  one-tap cashout
 *   └────────────────────────────────────────────────┘
 *
 * Both Up/Down buttons fire `placeBet()` directly with no confirmation sheet.
 * The cash-out button fires `cashout()` directly. Stake stepper increments
 * by tap; presets cycle 1 → 5 → 10 → 25 → 1.
 *
 * Hidden on lg+ — desktop uses the sticky right-column trade panel instead.
 */
export function SpeedMobileTradeBar({
  market,
  position,
  livePrice,
  isStale,
  onBetPlaced,
}: {
  market: SpeedMarket;
  position: SpeedPosition | null;
  livePrice: number | null;
  isStale: boolean;
  onBetPlaced: () => void;
}) {
  const t = useTranslations("speed");
  const { placeBet, loading: betLoading } = useSpeedExecuteTrade();
  const { cashout, loading: cashLoading } = useSpeedCashout();
  const feeConfig = useSpeedFeeConfig();
  const { iv, spread, extremeSpreadCoeff, realizedVol } = feeConfig;
  const [stake, setStake] = useState<number>(5);
  const totalSeconds = durationToSeconds(market.duration);
  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0 || market.status !== "open";

  // ── No-position branch: stake stepper + Up/Down ────────────────────────
  if (!position || position.status !== "open") {
    const strike = Number(market.strike_price);
    // Mig 352 (Seam 4): prefer realized-vol σ from RV cache so client matches server.
    const sigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
    const fairOver =
      livePrice && !isStale
        ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
        : null;
    // Mig 352 (Seam 3): speedOfferedProb no longer returns null — widens spread instead.
    // Mig 356: secondsLeft enables late-window surcharge in the last 30s.
    const offeredOver =
      fairOver !== null ? speedOfferedProb(fairOver, "over", spread, extremeSpreadCoeff, secondsLeft) : null;
    const offeredUnder =
      fairOver !== null ? speedOfferedProb(fairOver, "under", spread, extremeSpreadCoeff, secondsLeft) : null;

    const upPayout = offeredOver ? stake / offeredOver : null;
    const downPayout = offeredUnder ? stake / offeredUnder : null;
    const upProfit = upPayout !== null ? upPayout - stake : null;
    const downProfit = downPayout !== null ? downPayout - stake : null;

    const canBet = !expired && !isStale && fairOver !== null && stake > 0 && !betLoading;

    const handleBet = async (side: SpeedSide) => {
      if (!canBet) return;
      triggerHapticConfirm();
      // Mig 369: send IV snapshot for quote/execute parity.
      const { error: err } = await placeBet(market.id, side, stake, sigma);
      if (!err) onBetPlaced();
    };

    const cyclePreset = () => {
      const idx = STAKE_PRESETS.indexOf(stake);
      const next = idx === -1 ? 1 : (idx + 1) % STAKE_PRESETS.length;
      setStake(STAKE_PRESETS[next]);
    };

    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border-custom bg-bg/95 backdrop-blur-sm pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-3 px-4"
        role="region"
        aria-label="Speed trade bar"
      >
        {/* Stake stepper */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <button
            type="button"
            onClick={() => setStake(Math.max(1, stake - 1))}
            disabled={betLoading || expired}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-custom bg-surface text-text disabled:opacity-50"
            aria-label="Decrease stake"
          >
            <Minus className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={cyclePreset}
            className="font-satoshi text-2xl font-extrabold tabular-nums text-text px-3 py-0.5 rounded-md hover:bg-surface transition"
            aria-label={`Stake $${stake} — tap to cycle preset`}
          >
            ${stake}
          </button>
          <button
            type="button"
            onClick={() => setStake(stake + 1)}
            disabled={betLoading || expired}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-custom bg-surface text-text disabled:opacity-50"
            aria-label="Increase stake"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Up / Down buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleBet("over")}
            disabled={!canBet}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-4 py-3 font-satoshi font-bold text-white shadow-sm transition active:translate-y-px",
              "bg-success disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[56px]",
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-base uppercase tracking-wide">{t("up")}</span>
              <span className="text-base font-extrabold tabular-nums">
                {offeredOver !== null ? `${Math.round(offeredOver * 100)}%` : "—"}
              </span>
            </div>
            {upProfit !== null && (
              <span className="text-[11px] font-bold tabular-nums opacity-90">
                +${upProfit.toFixed(2)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleBet("under")}
            disabled={!canBet}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-4 py-3 font-satoshi font-bold text-white shadow-sm transition active:translate-y-px",
              "bg-destructive disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[56px]",
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-base uppercase tracking-wide">{t("down")}</span>
              <span className="text-base font-extrabold tabular-nums">
                {offeredUnder !== null ? `${Math.round(offeredUnder * 100)}%` : "—"}
              </span>
            </div>
            {downProfit !== null && (
              <span className="text-[11px] font-bold tabular-nums opacity-90">
                +${downProfit.toFixed(2)}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Open-position branch: one-tap CASH OUT ─────────────────────────────
  const strike = Number(market.strike_price);
  const stakeAmt = Number(position.stake);
  const entryProb = Number(position.entry_offered_prob);
  // Mig 369: payoutPerDollar (=1/entryProb) is now baked into the cashout
  // formula via (markProb / entryProb), no separate variable needed.

  // Mig 369: continuous mark-to-market formula
  //   cashout = stake × (mark_prob / entry_offered) × decay × liq_discount
  // Use realized vol when fresh; falls back to fee_config IV. Cashout is
  // rejected entirely in the last 5 seconds.
  const cashoutSigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
  const cashoutLocked = secondsLeft < CASHOUT_REJECT_WINDOW_SECONDS;
  const fairOver =
    livePrice && !isStale
      ? speedFairProbOver(livePrice, strike, secondsLeft, cashoutSigma)
      : null;
  const markProb =
    fairOver !== null ? (position.side === "over" ? fairOver : 1 - fairOver) : null;

  const pct = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
  const decay = speedCashoutMultiplier(market.duration, pct, feeConfig);
  const liqDiscount = speedLiqDiscount(secondsLeft);

  let estCashout: number | null = null;
  if (markProb !== null && decay !== null) {
    const raw = stakeAmt * (markProb / entryProb) * decay * liqDiscount;
    estCashout = Math.max(0, Math.round(raw * 100) / 100);
  }

  const handleCashout = async () => {
    if (cashLoading || expired || cashoutLocked) return;
    triggerHapticConfirm();
    await cashout(position.id, cashoutSigma);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border-custom bg-bg/95 backdrop-blur-sm pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-3 px-4"
      role="region"
      aria-label="Speed cashout bar"
    >
      <button
        type="button"
        onClick={handleCashout}
        disabled={cashLoading || expired || isStale}
        className={cn(
          "flex w-full items-center justify-center rounded-xl px-4 py-3 font-satoshi text-base font-extrabold uppercase tracking-wide text-white shadow-sm transition active:translate-y-px",
          "bg-warning disabled:opacity-50 disabled:cursor-not-allowed",
          "min-h-[56px]",
        )}
      >
        {cashLoading
          ? "…"
          : `${t("cashOut")}${estCashout !== null ? ` · $${estCashout.toFixed(2)}` : ""}`}
      </button>
    </div>
  );
}
