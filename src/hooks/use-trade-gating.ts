"use client";

// Single source of truth for "is this trade entry blocked, and why?"
// Used by speed-trade-panel.tsx (desktop) and speed-mobile-trade-bar.tsx
// to gate the BUY UP / BUY DOWN buttons.
//
// Why a hook: before this, three components computed the same OR/?? logic
// inline and drifted. One place to fix bugs, one place to reason about
// freshness vs authority.
//
// The freshness problem this fixes
// --------------------------------
// Chart price comes from Binance WS at 50-200ms. The polled /api/speed/quote
// is up to ~1750ms behind (1500ms refetch + 250ms server cache). Before, the
// gating booleans preferred the server value via `??`, so the button stayed
// green for 1-2s after the chart said it shouldn't be tradeable.
//
// The fix: monotonic OR-gating. A side is blocked when EITHER the fresh-
// but-shading-blind local helper OR the up-to-1750ms-stale server flag says
// so. Both signals are restrictors-only (never permit), so OR is safe.
//
// For normal users the local helper fires first (real-time gray-out).
// For sharks (users with a speed_user_edge_scores row), the server applies
// CLV shading + matrix push that the client cannot replicate. The server
// flag is the binding signal in that case — still correct because OR
// captures whichever is more restrictive.
//
// Display values vs gating
// ------------------------
// `offeredForDisplay` and `fairForDisplay` are SERVER-first because the
// server price is what the user actually pays. Local is fallback only
// (anonymous + quote-loading state) — local would mislead on the payout
// amount for sharks since it ignores shading.

import { useMemo } from "react";
import {
  ENTRY_LATE_WINDOW_REJECT_S,
  isEntryRejectedNearDecided,
  isEntrySoftBlocked,
  speedFairProbOver,
  speedOfferedProb,
} from "@/lib/speed/pricing";
import type { SpeedFeeConfig } from "@/lib/query/speed-fees/queries";
import type { SpeedTradeQuote } from "@/hooks/use-speed-quote";
import type { SpeedMarket, SpeedSide } from "@/types/database";

export interface TradeGatingArgs {
  /** Server-authoritative quote, or null while loading / anon. */
  tradeQuote: SpeedTradeQuote | null;
  /** Live BTC price from Binance WS. */
  livePrice: number | null;
  /** Volatility used for the local fair_prob computation (must match server's IV source). */
  sigma: number;
  /** Market the side is being placed on. */
  market: SpeedMarket;
  /** Which side the user has selected. */
  side: SpeedSide;
  /** Seconds until the market closes (countdown). */
  secondsLeft: number;
  /** Whether the WS feed is reporting stale. */
  isStale: boolean;
  /** Fee config snapshot (used by the local pricing helpers). */
  feeConfig: SpeedFeeConfig;
}

export interface TradeGating {
  /** Soft-block fires when offered_prob >= soft_block_threshold (default 0.95). */
  softBlocked: boolean;
  /** Last-30s near-decided block (|fair - 0.5| > 0.30 in last 30s) OR fair > 0.97 / < 0.03. */
  nearDecidedReject: boolean;
  /** Last-10s entry reject. */
  lateRejected: boolean;
  /** Server-first display price (what the user pays). Local fallback while loading. */
  offeredForDisplay: number | null;
  /** Server-first display fair prob. Local fallback while loading. */
  fairForDisplay: number | null;
  /** Local-only fair_prob (used by parity snapshots and divergence detection). */
  localFair: number | null;
  /** Local-only offered_prob (ignores shading + matrix; used by divergence detection). */
  localOffered: number | null;
  /** True when local and server offered_prob diverge >5% absolute. UI shows "Refreshing…". */
  isQuoteStale: boolean;
}

export function useTradeGating(args: TradeGatingArgs): TradeGating {
  // `isStale` intentionally not destructured — see note below on monotonic
  // OR-gating + comment in the args type. Reserved on the hook surface for
  // future use (e.g., a "feed reconnecting" UI hint).
  const { tradeQuote, livePrice, sigma, market, side, secondsLeft, feeConfig } = args;

  const strike = useMemo(() => Number(market.strike_price), [market.strike_price]);

  // Local fair_prob — fresh (driven by Binance WS livePrice).
  // Doesn't see server-side shading or matrix push; that's why we OR with
  // the server flag below rather than replacing it.
  //
  // Note: we deliberately do NOT guard on `isStale` here. During a transient
  // staleness window we still want to show the last-known price + gating
  // (server is protected separately via `canTrade && !isStale` at the call
  // site). Gating with stale local data is monotonic-safe (only restricts).
  const localFairOver = useMemo(() => {
    if (livePrice == null) return null;
    return speedFairProbOver(livePrice, strike, secondsLeft, sigma);
  }, [livePrice, strike, secondsLeft, sigma]);

  const localFair = useMemo(() => {
    if (localFairOver == null) return null;
    return side === "over" ? localFairOver : 1 - localFairOver;
  }, [localFairOver, side]);

  const localOffered = useMemo(() => {
    if (localFairOver == null) return null;
    return speedOfferedProb(localFairOver, side, feeConfig, secondsLeft);
  }, [localFairOver, side, feeConfig, secondsLeft]);

  const lateRejectS =
    feeConfig.pricing.cashoutLateRejectS ?? ENTRY_LATE_WINDOW_REJECT_S;

  // Monotonic OR — whichever signal restricts first wins.
  // Both signals are restrictors-only (never permit), so OR is safe AND
  // captures the union of "fresh local view" + "shading-aware server view".
  const softBlocked =
    tradeQuote?.soft_blocked === true ||
    (localOffered !== null && isEntrySoftBlocked(localOffered, feeConfig));

  const nearDecidedReject =
    tradeQuote?.near_decided_block === true ||
    (localFair !== null && isEntryRejectedNearDecided(localFair, secondsLeft, feeConfig));

  const lateRejected =
    tradeQuote?.late_window_block === true || secondsLeft < lateRejectS;

  // Display: server-first (authoritative price the user pays).
  // Local is fallback only — local ignores shading and would mislead on payout.
  const offeredForDisplay = tradeQuote?.offered_prob ?? localOffered;
  const fairForDisplay = tradeQuote?.fair_prob_side ?? localFair;

  // Divergence detector: if local and server offered_prob disagree by more
  // than 5% absolute, surface a "Refreshing…" hint so the user doesn't act
  // on materially wrong odds. Auto-clears on next quote arrival.
  const isQuoteStale =
    tradeQuote != null &&
    localOffered !== null &&
    Math.abs(localOffered - tradeQuote.offered_prob) > 0.05;

  return {
    softBlocked,
    nearDecidedReject,
    lateRejected,
    offeredForDisplay,
    fairForDisplay,
    localFair,
    localOffered,
    isQuoteStale,
  };
}
