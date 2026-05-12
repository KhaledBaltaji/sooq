"use client";

// Cashout-side counterpart of use-trade-gating.
//
// Same monotonic OR-gating pattern: a cashout is blocked when EITHER the
// fresh-but-shading-blind local helper OR the up-to-1750ms-stale server
// flag says so. Used by both speed-position-panel.tsx (desktop) and the
// open-position branch of speed-mobile-trade-bar.tsx.
//
// Differences from trade gating:
// - No soft_block (cashout doesn't have one)
// - cap_edge replaces soft_block as the "hold to settlement" gate
// - No fair_prob check; gate is on mark_prob

import { useMemo } from "react";
import {
  CASHOUT_REJECT_WINDOW_SECONDS,
  computeCashoutAmount,
  isCashoutAtCapEdge,
  isCashoutRejectedNearDecided,
  speedCashoutMargin,
  speedFairProbOver,
} from "@/lib/speed/pricing";
import type { SpeedFeeConfig } from "@/lib/query/speed-fees/queries";
import type { SpeedCashoutQuote } from "@/hooks/use-speed-quote";
import type { SpeedMarket, SpeedPosition } from "@/types/database";

export interface CashoutGatingArgs {
  cashoutQuote: SpeedCashoutQuote | null;
  livePrice: number | null;
  sigma: number;
  market: SpeedMarket;
  /** Nullable so callers can satisfy Rules of Hooks without a position present. */
  position: SpeedPosition | null;
  secondsLeft: number;
  isStale: boolean;
  feeConfig: SpeedFeeConfig;
}

export interface CashoutGating {
  /** Last-30s near-decided cashout block. */
  cashoutLockedNearDecided: boolean;
  /** Last-10s cashout reject. */
  cashoutLockedLate: boolean;
  /** Entry and current mark both at price cap — hold to settlement. */
  cashoutAtCap: boolean;
  /**
   * 0062 Phase 5e: market-level cashout disabled (currently all 1m markets).
   * When true, the panel should render a passive position monitor (showing
   * stake + settlement payout) instead of a cashout button. Distinct from
   * the other gates because this is *structural* — the market never had
   * cashout available; there's no "wait and try again" path.
   */
  cashoutDisabledForMarket: boolean;
  /** Any cashout gate fires (includes cashoutDisabledForMarket). */
  cashoutLocked: boolean;
  /** Server-first cashout amount. Local fallback while loading. */
  cashoutAmountForDisplay: number | null;
  /** Server-first mark_prob. Local fallback while loading. */
  markProbForDisplay: number | null;
  /** Server-first is_winning. Local fallback. */
  isWinning: boolean;
  /** Server-first margin_applied. Local fallback. */
  marginForDisplay: number;
  /** True when local and server cashout amount diverge >5% relative. */
  isQuoteStale: boolean;
}

export function useCashoutGating(args: CashoutGatingArgs): CashoutGating {
  // `isStale` intentionally not destructured — see useTradeGating for the
  // same rationale. Reserved on the hook surface for future use.
  const { cashoutQuote, livePrice, sigma, market, position, secondsLeft, feeConfig } = args;

  const strike = useMemo(() => Number(market.strike_price), [market.strike_price]);
  const stake = useMemo(() => (position ? Number(position.stake) : 0), [position]);
  const entryProb = useMemo(
    () => (position ? Number(position.entry_offered_prob) : 0),
    [position],
  );
  const side = position?.side ?? null;

  // Local mark_prob — fresh (driven by Binance WS livePrice).
  //
  // Note: we deliberately do NOT guard on `isStale` here. See useTradeGating
  // for rationale (last-known price still useful for display + gating is
  // monotonic-safe).
  const localFairOver = useMemo(() => {
    if (livePrice == null) return null;
    return speedFairProbOver(livePrice, strike, secondsLeft, sigma);
  }, [livePrice, strike, secondsLeft, sigma]);

  const localMarkProb = useMemo(() => {
    if (localFairOver == null || side == null) return null;
    return side === "over" ? localFairOver : 1 - localFairOver;
  }, [localFairOver, side]);

  const { localCashout, localIsWinning, localMargin } = useMemo(() => {
    if (localMarkProb == null) {
      return { localCashout: null as number | null, localIsWinning: false, localMargin: 0 };
    }
    const winning = localMarkProb >= entryProb;
    const m = speedCashoutMargin(market.duration, winning, localMarkProb, secondsLeft, feeConfig);
    const raw = computeCashoutAmount(stake, entryProb, localMarkProb, winning, m);
    return {
      localCashout: Math.max(0, Math.round(raw * 100) / 100),
      localIsWinning: winning,
      localMargin: m,
    };
  }, [localMarkProb, entryProb, market.duration, secondsLeft, feeConfig, stake]);

  const lateRejectS =
    feeConfig.pricing.cashoutLateRejectS ?? CASHOUT_REJECT_WINDOW_SECONDS;

  // Monotonic OR — server flag OR local predicate.
  const cashoutLockedLate =
    cashoutQuote?.late_window_block === true || secondsLeft < lateRejectS;

  const cashoutLockedNearDecided =
    cashoutQuote?.near_decided_block === true ||
    (localMarkProb !== null &&
      isCashoutRejectedNearDecided(localMarkProb, secondsLeft, feeConfig));

  const cashoutAtCap =
    cashoutQuote?.cap_edge === true ||
    (localMarkProb !== null && isCashoutAtCapEdge(entryProb, localMarkProb, feeConfig));

  // 0062 Phase 5e: market-level cashout disabled (1m markets currently).
  // Server is authoritative via cashoutQuote.cashout_available. Default true
  // (cashout available) when the field is undefined — safer fallback for
  // older clients / pre-deploy quote responses.
  const cashoutDisabledForMarket = cashoutQuote?.cashout_available === false;

  const cashoutLocked =
    cashoutLockedLate ||
    cashoutLockedNearDecided ||
    cashoutAtCap ||
    cashoutDisabledForMarket;

  // Display: server-first.
  const cashoutAmountForDisplay = cashoutQuote?.cashout_amount ?? localCashout;
  const markProbForDisplay = cashoutQuote?.mark_prob ?? localMarkProb;
  const isWinning = cashoutQuote?.is_winning ?? localIsWinning;
  const marginForDisplay = cashoutQuote?.margin_applied ?? localMargin;

  // Divergence detector: 5% relative for cashout amounts (they vary in
  // absolute size depending on stake, so relative > absolute).
  const isQuoteStale =
    cashoutQuote != null &&
    localCashout !== null &&
    Math.abs(localCashout - cashoutQuote.cashout_amount) /
      Math.max(1, cashoutQuote.cashout_amount) > 0.05;

  return {
    cashoutLockedNearDecided,
    cashoutLockedLate,
    cashoutAtCap,
    cashoutDisabledForMarket,
    cashoutLocked,
    cashoutAmountForDisplay,
    markProbForDisplay,
    isWinning,
    marginForDisplay,
    isQuoteStale,
  };
}
