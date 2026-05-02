/**
 * Branch pricing utilities — markup math, odds conversion, branch trade previews.
 * Pure functions, no React. Reuses LMSR math from market-utils.ts.
 */

import { estimateSharesForAmount, estimateCloseValue, type EstimateFeeRates } from "./market-utils";
import { RESOLUTION_FEE_RATE } from "./constants";

// ============================================================
// Markup & Odds
// ============================================================

/**
 * Apply branch markup to a canonical LMSR price.
 * Canonical price is what the AMM charges. Gross cost is what the user pays.
 * Formula: grossCostPerShare = canonical / (1 - markupPct)
 * Example: 0.52 canonical, 5% markup → 0.5474
 */
export function applyMarkup(canonicalPrice: number, markupPct: number): number {
  if (markupPct >= 1) return Infinity;
  return canonicalPrice / (1 - markupPct);
}

/**
 * Convert gross cost per share to decimal odds.
 * Payout is $(1 - resolutionFee) per winning share.
 * Formula: odds = (1 - resolutionFee) / grossCostPerShare
 * Example: grossCost 0.5474 → 1.81x (at 1% resolution fee)
 */
export function toDecimalOdds(grossCostPerShare: number, resolutionFee: number = RESOLUTION_FEE_RATE): number {
  if (grossCostPerShare <= 0) return Infinity;
  return (1 - resolutionFee) / grossCostPerShare;
}

/**
 * Format decimal odds for display: "1.81x"
 */
export function formatDecimalOdds(odds: number): string {
  if (!isFinite(odds) || odds <= 0) return "—";
  return `${odds.toFixed(2)}x`;
}

/**
 * Format a branch price based on display mode.
 * Trading mode: "54.7%" (percentage)
 * Betting mode: "1.81x" (decimal odds)
 */
export function formatBranchPrice(
  canonicalPrice: number,
  markupPct: number,
  displayMode: "trading" | "betting"
): string {
  const gross = applyMarkup(canonicalPrice, markupPct);
  if (displayMode === "betting") {
    return formatDecimalOdds(toDecimalOdds(gross));
  }
  // Trading mode: show as percentage (markup-adjusted)
  const pct = gross * 100;
  if (pct <= 0) return "0%";
  if (pct >= 100) return "100%";
  return `${pct.toFixed(1)}%`;
}

// ============================================================
// Branch Trade Previews
// ============================================================

export interface BranchBuyPreview {
  shares: number;
  grossCost: number;
  markupFee: number;
  platformFee: number;
  netToAmm: number;
  effectivePrice: number;
}

/**
 * Estimate what a branch user gets when buying shares.
 * User pays `amount`. Branch takes markup. Remaining goes to LMSR (which deducts platform fee).
 */
export function estimateBranchBuyPreview(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  amount: number,
  markupPct: number,
  feeRates?: EstimateFeeRates
): BranchBuyPreview {
  const markupFee = amount * markupPct;
  const afterMarkup = amount - markupFee;

  // estimateSharesForAmount deducts the platform fee internally
  const { shares, fee: platformFee, pricePerShare } = estimateSharesForAmount(
    b, qYes, qNo, side, afterMarkup, feeRates
  );

  return {
    shares,
    grossCost: amount,
    markupFee,
    platformFee,
    netToAmm: afterMarkup - platformFee,
    effectivePrice: pricePerShare,
  };
}

export interface BranchSellPreview {
  grossProceeds: number;
  platformFee: number;
  platformCloseFee: number;
  exitFee: number;
  netReceived: number;
}

/**
 * Estimate what a branch user gets when selling shares.
 * LMSR gives gross proceeds, platform takes explicit + close fees, branch takes exit fee.
 */
export function estimateBranchSellPreview(
  b: number,
  qYes: number,
  qNo: number,
  side: "yes" | "no",
  shares: number,
  exitFeePct: number,
  feeRates?: EstimateFeeRates
): BranchSellPreview {
  const { grossProceeds, fee: platformFee, closeFee: platformCloseFee } = estimateCloseValue(
    b, qYes, qNo, side, shares, feeRates
  );

  const exitFee = grossProceeds * exitFeePct;
  const netReceived = grossProceeds - platformFee - platformCloseFee - exitFee;

  return {
    grossProceeds,
    platformFee,
    platformCloseFee,
    exitFee,
    netReceived: Math.max(0, netReceived),
  };
}
