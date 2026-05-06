"use client";

import { useEffect, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatCurrency, triggerHapticConfirm } from "@/lib/utils";
import {
  CASHOUT_REJECT_WINDOW_SECONDS,
  computeCashoutAmount,
  ENTRY_LATE_WINDOW_REJECT_S,
  isCashoutRejectedNearDecided,
  isEntryRejectedNearDecided,
  speedCashoutMargin,
  speedFairProbOver,
  speedOfferedProb,
  speedSecondsLeftBucket,
} from "@/lib/speed/pricing";
import {
  useSpeedExecuteTrade,
  useSpeedCashout,
  type CashoutParitySnapshot,
  type TradeParitySnapshot,
} from "@/hooks/use-speed-trade";
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
  const { iv, realizedVol } = feeConfig;
  const [stake, setStake] = useState<number>(5);
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
    // Mig 0028+: prefer realized-vol σ from RV cache so client matches server.
    const sigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
    const fairOver =
      livePrice && !isStale
        ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
        : null;
    // Mig 0028: multiplicative late-window spread escalation; clamp to [0.03, 0.97].
    const offeredOver =
      fairOver !== null ? speedOfferedProb(fairOver, "over", feeConfig, secondsLeft) : null;
    const offeredUnder =
      fairOver !== null ? speedOfferedProb(fairOver, "under", feeConfig, secondsLeft) : null;

    const upPayout = offeredOver ? stake / offeredOver : null;
    const downPayout = offeredUnder ? stake / offeredUnder : null;
    const upProfit = upPayout !== null ? upPayout - stake : null;
    const downProfit = downPayout !== null ? downPayout - stake : null;

    // Mig 0028 entry-side gating mirrored on client.
    const lateRejectS =
      feeConfig.pricing.cashoutLateRejectS ?? ENTRY_LATE_WINDOW_REJECT_S;
    const lateRejected = secondsLeft < lateRejectS;
    const fairOverGate =
      fairOver !== null
        ? isEntryRejectedNearDecided(fairOver, secondsLeft, feeConfig)
        : false;
    const fairUnderGate =
      fairOver !== null
        ? isEntryRejectedNearDecided(1 - fairOver, secondsLeft, feeConfig)
        : false;
    const canBetOver =
      !expired && !isStale && fairOver !== null && stake > 0 && !betLoading &&
      !lateRejected && !fairOverGate;
    const canBetUnder =
      !expired && !isStale && fairOver !== null && stake > 0 && !betLoading &&
      !lateRejected && !fairUnderGate;

    const handleBet = async (side: SpeedSide) => {
      const allowed = side === "over" ? canBetOver : canBetUnder;
      if (!allowed) return;
      triggerHapticConfirm();
      // Mig 0030: full quote/execute parity snapshot.
      const fairForSide = side === "over" ? fairOver : 1 - (fairOver ?? 0);
      const offeredForSide = side === "over" ? offeredOver : offeredUnder;
      const parity: TradeParitySnapshot = {
        expectedIv: sigma,
        expectedSpot: livePrice ?? undefined,
        expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
        expectedFairProb: fairForSide ?? undefined,
        expectedOfferedProb: offeredForSide ?? undefined,
      };
      const { error: err } = await placeBet(market.id, side, stake, parity);
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
            disabled={!canBetOver}
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
                +{formatCurrency(upProfit)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleBet("under")}
            disabled={!canBetUnder}
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
                +{formatCurrency(downProfit)}
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

  // Mig 0028: option-C profit-based cashout. Use realized vol when fresh;
  // falls back to fee_config IV. Cashout rejected in last 10s + last-30s
  // near-decided block.
  const cashoutSigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
  const lateRejectS =
    feeConfig.pricing.cashoutLateRejectS ?? CASHOUT_REJECT_WINDOW_SECONDS;
  const cashoutLockedLate = secondsLeft < lateRejectS;
  const fairOver =
    livePrice && !isStale
      ? speedFairProbOver(livePrice, strike, secondsLeft, cashoutSigma)
      : null;
  const markProb =
    fairOver !== null ? (position.side === "over" ? fairOver : 1 - fairOver) : null;

  let estCashout: number | null = null;
  if (markProb !== null) {
    const isWinning = markProb >= entryProb;
    const margin = speedCashoutMargin(
      market.duration,
      isWinning,
      markProb,
      secondsLeft,
      feeConfig,
    );
    const raw = computeCashoutAmount(
      stakeAmt,
      entryProb,
      markProb,
      isWinning,
      margin,
    );
    estCashout = Math.max(0, Math.round(raw * 100) / 100);
  }

  const cashoutLockedNearDecided =
    markProb !== null &&
    isCashoutRejectedNearDecided(markProb, secondsLeft, feeConfig);
  const cashoutLocked = cashoutLockedLate || cashoutLockedNearDecided;

  const handleCashout = async () => {
    if (cashLoading || expired || cashoutLocked) return;
    triggerHapticConfirm();
    // Mig 0030: full quote/execute parity snapshot.
    const parity: CashoutParitySnapshot = {
      expectedIv: cashoutSigma,
      expectedSpot: livePrice ?? undefined,
      expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
      expectedMarkProb: markProb ?? undefined,
      expectedCashoutAmount: estCashout ?? undefined,
    };
    await cashout(position.id, parity);
  };

  let cashoutLabel: string;
  if (cashLoading) {
    cashoutLabel = "";
  } else if (cashoutLockedLate) {
    cashoutLabel = t("cashoutLockedLate");
  } else if (cashoutLockedNearDecided) {
    cashoutLabel = t("cashoutLockedNearDecided");
  } else if (estCashout !== null) {
    cashoutLabel = `${t("cashOut")} · ${formatCurrency(estCashout)}`;
  } else {
    cashoutLabel = t("cashOut");
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border-custom bg-bg/95 backdrop-blur-sm pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-3 px-4"
      role="region"
      aria-label="Speed cashout bar"
    >
      <button
        type="button"
        onClick={handleCashout}
        disabled={cashLoading || expired || isStale || cashoutLocked}
        className={cn(
          "flex w-full items-center justify-center rounded-xl px-4 py-3 font-satoshi text-base font-extrabold uppercase tracking-wide text-white shadow-sm transition active:translate-y-px",
          "bg-warning disabled:opacity-50 disabled:cursor-not-allowed",
          "min-h-[56px]",
        )}
      >
        {cashLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          cashoutLabel
        )}
      </button>
    </div>
  );
}
