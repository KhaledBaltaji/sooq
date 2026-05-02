import type { Market, MarketTimeState, AmmState } from "@/types/market";
import { CLOSING_SOON_HOURS, EXPLICIT_FEE_RATE, CLOSE_POSITION_FEE_RATE, SHARES_PER_LOT, MAX_TRADE_PCT_OF_LIQUIDITY } from "./constants";

/**
 * Fee rates used by client-side preview math. Callers should pass live rates
 * from `useFeeRates()` so admin edits to `fee_config` propagate to the UI.
 * Defaults are the hardcoded fallbacks — used only when the hook hasn't
 * resolved or when these functions are called outside a React tree.
 */
export interface EstimateFeeRates {
  explicit: number;
  cashOut: number;
}

const DEFAULT_ESTIMATE_FEES: EstimateFeeRates = {
  explicit: EXPLICIT_FEE_RATE,
  cashOut: CLOSE_POSITION_FEE_RATE,
};

// ============================================================
// Market time state (unchanged from V2)
// ============================================================

export function getMarketTimeState(market: Market): MarketTimeState {
  const now = new Date();
  const opens = new Date(market.opens_at);
  const closes = new Date(market.closes_at);
  const closingSoonThreshold = CLOSING_SOON_HOURS * 60 * 60 * 1000;

  if (market.status === "resolved") return "resolved";
  if (market.status === "voided") return "voided";
  if (market.status === "closed") return "closed";
  if (now < opens) return "upcoming";
  if (closes.getTime() - now.getTime() < closingSoonThreshold) return "closing_soon";
  if (now < closes) return "open";
  return "closed";
}

// Rough USD cap on a single trade, derived from the AMM's liquidity param `b`.
// Matches the LMSR max-shares cap (MAX_TRADE_PCT_OF_LIQUIDITY × b) priced at
// mid (~$0.50) with a 10% buffer. Good enough for a "try smaller" hint —
// authoritative cap lives in `execute_trade`.
export function getMaxTradeUsd(ammState: AmmState | null | undefined): number | undefined {
  if (!ammState) return undefined;
  return Math.floor(MAX_TRADE_PCT_OF_LIQUIDITY * ammState.liquidity_param * 0.5 * 1.1);
}

// ============================================================
// LMSR Math — Client-side mirrors of backend (107_v3_fn_lmsr_math.sql)
// Used for instant UI feedback before RPC response
// ============================================================

/**
 * LMSR cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
 * Uses log-sum-exp trick for numerical stability.
 */
export function lmsrCost(b: number, qYes: number, qNo: number): number {
  const maxQ = Math.max(qYes, qNo);
  const diff = Math.abs(qYes - qNo);
  return b * (maxQ / b + Math.log(1 + Math.exp(-diff / b)));
}

/**
 * LMSR price for a side. Returns value in (0, 1).
 * Sigmoid: P(side) = 1 / (1 + e^((q_other - q_side)/b))
 */
export function lmsrPrice(b: number, qYes: number, qNo: number, side: "yes" | "no"): number {
  const diff = side === "yes" ? (qYes - qNo) / b : (qNo - qYes) / b;
  if (diff >= 0) {
    return 1 / (1 + Math.exp(-diff));
  }
  const expVal = Math.exp(diff);
  return expVal / (1 + expVal);
}

/**
 * Inverse LMSR: given a dollar cost, how many shares can you buy?
 * Closed-form, computed in log space.
 */
export function lmsrSharesForCost(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  cost: number
): number {
  const qSide = side === "yes" ? qYes : qNo;
  const qOther = side === "yes" ? qNo : qYes;

  const costOverB = cost / b;
  const sideOverB = qSide / b;
  const otherOverB = qOther / b;

  const maxQOverB = Math.max(sideOverB, otherOverB);
  const lnSumExp = maxQOverB + Math.log(1 + Math.exp(-Math.abs(sideOverB - otherOverB)));

  const A = costOverB + lnSumExp;
  const B = otherOverB;

  if (A <= B) return 0;

  const lnInner = A + Math.log(1 - Math.exp(B - A));
  const shares = b * lnInner - qSide;

  return Math.max(shares, 0);
}

// ============================================================
// AMM utility functions
// ============================================================

/**
 * Get probability percentages from AMM state.
 */
export function getAmmProbability(ammState: AmmState): { yes: number; no: number } {
  const yes = Math.round(ammState.current_yes_price * 100);
  return { yes, no: 100 - yes };
}

/**
 * Estimate close position value for selling shares (client-side preview).
 * Returns net proceeds after fees.
 */
export function estimateCloseValue(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  shares: number,
  feeRates: EstimateFeeRates = DEFAULT_ESTIMATE_FEES
): { grossProceeds: number; fee: number; closeFee: number; netProceeds: number } {
  const oldCost = lmsrCost(b, qYes, qNo);
  const newCost = side === "yes"
    ? lmsrCost(b, qYes - shares, qNo)
    : lmsrCost(b, qYes, qNo - shares);

  const grossProceeds = oldCost - newCost;
  const fee = grossProceeds * feeRates.explicit;
  const closeFee = grossProceeds * feeRates.cashOut;
  const netProceeds = grossProceeds - fee - closeFee;

  return { grossProceeds, fee, closeFee, netProceeds };
}

/**
 * Estimate shares purchasable with a dollar amount (after fees).
 */
export function estimateSharesForAmount(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  amount: number,
  feeRates: EstimateFeeRates = DEFAULT_ESTIMATE_FEES
): { shares: number; fee: number; pricePerShare: number } {
  const fee = amount * feeRates.explicit;
  const netAmount = amount - fee;
  const shares = lmsrSharesForCost(b, qYes, qNo, side, netAmount);
  const pricePerShare = shares > 0 ? netAmount / shares : 0;

  return { shares, fee, pricePerShare };
}

/**
 * Estimate shares to sell to receive a target dollar amount (inverse of estimateCloseValue).
 * Uses binary search since the LMSR cost function isn't trivially invertible for this.
 */
export function estimateSharesForClose(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  targetDollars: number,
  maxShares: number,
  feeRates: EstimateFeeRates = DEFAULT_ESTIMATE_FEES
): { shares: number; grossProceeds: number; fee: number; closeFee: number; netProceeds: number } {
  if (targetDollars <= 0 || maxShares <= 0) {
    return { shares: 0, grossProceeds: 0, fee: 0, closeFee: 0, netProceeds: 0 };
  }

  // Check if selling all shares gives enough
  const maxResult = estimateCloseValue(b, qYes, qNo, side, maxShares, feeRates);
  if (maxResult.netProceeds <= targetDollars) {
    return { shares: maxShares, ...maxResult };
  }

  // Binary search for the right share count
  let lo = 0;
  let hi = maxShares;
  const EPSILON = 0.001; // $0.001 precision
  const MAX_ITER = 50;

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const result = estimateCloseValue(b, qYes, qNo, side, mid, feeRates);
    if (Math.abs(result.netProceeds - targetDollars) < EPSILON) {
      return { shares: mid, ...result };
    }
    if (result.netProceeds < targetDollars) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Return best approximation
  const finalShares = (lo + hi) / 2;
  const finalResult = estimateCloseValue(b, qYes, qNo, side, finalShares, feeRates);
  return { shares: finalShares, ...finalResult };
}

/**
 * Estimate the USD cost to buy a specific number of shares.
 * Inverse of estimateSharesForAmount — given shares, what's the cost?
 */
export function estimateCostForShares(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  targetShares: number,
  feeRates: EstimateFeeRates = DEFAULT_ESTIMATE_FEES
): { cost: number; fee: number; pricePerShare: number } {
  if (targetShares <= 0) {
    return { cost: 0, fee: 0, pricePerShare: 0 };
  }

  // Cost difference from LMSR = what the AMM charges for these shares (before fees)
  const oldCost = lmsrCost(b, qYes, qNo);
  const newCost = side === "yes"
    ? lmsrCost(b, qYes + targetShares, qNo)
    : lmsrCost(b, qYes, qNo + targetShares);

  const netAmount = newCost - oldCost; // cost without fees
  // netAmount = totalCost - fee = totalCost - totalCost * feeRate = totalCost * (1 - feeRate)
  // So totalCost = netAmount / (1 - feeRate)
  const totalCost = netAmount / (1 - feeRates.explicit);
  const fee = totalCost * feeRates.explicit;
  const pricePerShare = targetShares > 0 ? netAmount / targetShares : 0;

  return { cost: totalCost, fee, pricePerShare };
}

/**
 * Convert backend shares to display lots (1 lot = 1000 shares).
 */
export function sharesToLots(shares: number): number {
  return shares / SHARES_PER_LOT;
}

/**
 * Convert user-facing lots to backend shares (1 lot = 1000 shares).
 */
export function lotsToShares(lots: number): number {
  return lots * SHARES_PER_LOT;
}

/**
 * Format backend share count as lots for display (3 decimal places).
 * 0.001 lots = 1 share (minimum resolution).
 */
export function formatLots(shares: number): string {
  return sharesToLots(shares).toFixed(3);
}

/**
 * Format a 0–1 share price as 1-decimal % (e.g. "50.3%").
 * Default for all price displays.
 */
export function formatSharePrice(price: number): string {
  const pct = price * 100;
  if (pct <= 0) return "0%";
  if (pct >= 100) return "100%";
  return `${pct.toFixed(1)}%`;
}

/**
 * Directional price formatting — all contexts use 1-decimal precision.
 */
export function formatPrice(price: number, context: "buy" | "sell" | "neutral"): string {
  const pct = price * 100;
  if (pct <= 0) return "0%";
  if (pct >= 100) return "100%";
  return `${pct.toFixed(1)}%`;
}

/**
 * Display volume = 2x actual volume (each trade has a counterparty).
 * Use for user-facing UI only — admin pages should show raw total_volume.
 */
export function getDisplayVolume(totalVolume: number): number {
  return totalVolume * 2;
}
