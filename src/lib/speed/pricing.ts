/**
 * Client-side speed-market pricing.
 *
 * Mirrors the Postgres functions defined in mig 0028+:
 *   - normal_cdf
 *   - speed_fair_prob_over
 *   - _speed_cashout_margin (option C profit-based, mig 0028)
 *   - _speed_seconds_left_bucket (mig 0030)
 *   - speed_execute_trade spread escalation (mig 0028)
 *
 * Used for live OVER/UNDER prob display, cashout-amount preview, button-
 * gate predicates (last 30s near-decided block, last 10s reject), and
 * parity snapshot generation. Server RPCs always re-compute at execute
 * time; these helpers are display-only + parity-snapshot inputs.
 */

import type { SpeedDuration, SpeedSide } from "@/types/database";
import type { SpeedFeeConfig } from "@/lib/query/speed-fees/queries";

/**
 * Standard normal CDF — Abramowitz & Stegun 26.2.17 polynomial.
 * Accuracy ~7.5e-8.
 *
 * At |x| >= 37 the polynomial is indistinguishable from the asymptote
 * within float64; clip for parity with the SQL helper.
 */
export function normalCdf(x: number): number {
  const absX = Math.abs(x);
  if (absX >= 37) return x >= 0 ? 1 : 0;

  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const p = 0.2316419;

  const k = 1 / (1 + p * absX);
  const phi =
    (1 / Math.sqrt(2 * Math.PI)) * Math.exp((-absX * absX) / 2);
  const cdfPositive =
    1 -
    phi *
      (a1 * k +
        a2 * k * k +
        a3 * k * k * k +
        a4 * k * k * k * k +
        a5 * k * k * k * k * k);
  return x >= 0 ? cdfPositive : 1 - cdfPositive;
}

/**
 * Black-Scholes binary fair probability that spot > strike at expiry.
 *
 * Output clipped to [0.01, 0.99] to match the SQL clip in mig 357.
 * The wider clip created a round-trip arbitrage at extreme moneyness.
 */
export function speedFairProbOver(
  spot: number,
  strike: number,
  secondsLeft: number,
  iv: number,
): number {
  if (secondsLeft < 1) secondsLeft = 1;
  const yearsLeft = secondsLeft / (365 * 24 * 3600);
  const sigmaSqrtT = iv * Math.sqrt(yearsLeft);
  if (sigmaSqrtT === 0) {
    return spot > strike ? 0.99 : 0.01;
  }
  const d2 = (Math.log(spot / strike) - (iv * iv * yearsLeft) / 2) / sigmaSqrtT;
  const fairProb = normalCdf(d2);
  return Math.max(0.01, Math.min(0.99, fairProb));
}

// ============================================================================
// Mig 0028+ helpers
// ============================================================================

/**
 * Mig 0028: hard reject window for cashouts. Server-tunable via
 * fee_config.speed_cashout_late_reject_s (default 10s).
 */
export const CASHOUT_REJECT_WINDOW_SECONDS = 10;

/** Mig 0028: entries rejected entirely in the last N seconds (matches server). */
export const ENTRY_LATE_WINDOW_REJECT_S = 10;

/** Returns true when entries are rejected entirely (last 10s). */
export function isEntryRejectedLate(secondsLeft: number): boolean {
  return secondsLeft < ENTRY_LATE_WINDOW_REJECT_S;
}

/** Returns true when we're in any late-window tier (display purposes). */
export function isInLateWindow(secondsLeft: number): boolean {
  return secondsLeft < 60;
}

/**
 * Mig 0030: 4-bucket time discretisation.
 * Mirrors `_speed_seconds_left_bucket(secondsLeft)` SQL helper.
 *
 *   0  →  60s+         (no late-window surcharge)
 *   1  →  [30s, 60s)   (×1.4 spread)
 *   2  →  [10s, 30s)   (×1.8 spread + last-30s near-decided block)
 *   3  →  <10s         (rejected at execute)
 */
export function speedSecondsLeftBucket(secondsLeft: number): 0 | 1 | 2 | 3 {
  if (secondsLeft >= 60) return 0;
  if (secondsLeft >= 30) return 1;
  if (secondsLeft >= 10) return 2;
  return 3;
}

/**
 * Mig 0028: multiplicative spread escalation.
 * Mirrors the `v_spread_mult` block inside `speed_execute_trade`.
 *
 *   secondsLeft >= 60   → 1.0   (no escalation)
 *   secondsLeft ∈ [30, 60)  → fc.pricing.late60sSpreadMult  (default 1.4)
 *   secondsLeft < 30    → fc.pricing.late30sSpreadMult       (default 1.8)
 */
export function speedSpreadMultiplier(
  secondsLeft: number,
  fc: SpeedFeeConfig,
): number {
  if (secondsLeft < 30) return fc.pricing.late30sSpreadMult;
  if (secondsLeft < 60) return fc.pricing.late60sSpreadMult;
  return 1.0;
}

/**
 * Mig 0028: option-C profit-based cashout margin.
 * Mirrors `_speed_cashout_margin(duration, is_winning, mark_prob, seconds_left)`.
 *
 *   Winning side:
 *     margin = base_winning + saturation_premium + late_window_premium
 *     saturation = max(0, |mark − 0.5| − 0.35) × saturation_coef
 *     late_window = max(0, (60 − s)/60) × late_window_winning_coef
 *
 *   Losing side:
 *     margin = base_losing + desperation_premium + late_window_premium
 *     desperation = max(0, 0.50 − mark) × desperation_coef
 *     late_window = max(0, (60 − s)/60) × late_window_losing_coef
 *
 * Hard-capped at 0.50 (matches server defensive ceiling); floored at 0.
 */
export function speedCashoutMargin(
  duration: SpeedDuration,
  isWinning: boolean,
  markProb: number,
  secondsLeft: number,
  fc: SpeedFeeConfig,
): number {
  const lateRamp = Math.max(0, (60 - secondsLeft) / 60);
  let margin: number;
  if (isWinning) {
    const base =
      duration === "5m"
        ? fc.cashoutMargins.winningBase5m
        : fc.cashoutMargins.winningBase1h;
    const saturation =
      Math.max(0, Math.abs(markProb - 0.5) - 0.35) *
      fc.cashoutMargins.saturationCoef;
    const lateWindow = lateRamp * fc.cashoutMargins.lateWindowWinningCoef;
    margin = base + saturation + lateWindow;
  } else {
    const base =
      duration === "5m"
        ? fc.cashoutMargins.losingBase5m
        : fc.cashoutMargins.losingBase1h;
    const desperation =
      Math.max(0, 0.5 - markProb) * fc.cashoutMargins.desperationCoef;
    const lateWindow = lateRamp * fc.cashoutMargins.lateWindowLosingCoef;
    margin = base + desperation + lateWindow;
  }
  if (margin > 0.5) margin = 0.5;
  if (margin < 0) margin = 0;
  return margin;
}

/**
 * Mig 0028: option-C cashout amount.
 *
 *   fair_profit = stake × (mark_prob / entry_offered_prob − 1)
 *   winning side  cashout = stake + fair_profit × (1 − margin)
 *   losing  side  cashout = stake + fair_profit × (1 + margin)
 *
 * Direction-matching invariant by construction:
 *   mark_prob > entry_offered_prob ⇒ fair_profit > 0 ⇒ cashout > stake.
 *
 * Server floors at 0; we mirror that here for display.
 */
export function computeCashoutAmount(
  stake: number,
  entryOfferedProb: number,
  markProb: number,
  isWinning: boolean,
  margin: number,
): number {
  if (entryOfferedProb <= 0) return 0;
  const fairProfit = stake * (markProb / entryOfferedProb - 1);
  const cashout = isWinning
    ? stake + fairProfit * (1 - margin)
    : stake + fairProfit * (1 + margin);
  return Math.max(0, cashout);
}

/**
 * Mig 0028: predicate for entry-side gating.
 *   - Hard reject when fair_prob_side > fairProbRejectHigh (default 0.97)
 *   - Hard reject when fair_prob_side < fairProbRejectLow  (default 0.03)
 *   - In last 30s, reject when |fair − 0.5| > late30sImbalanceReject (default 0.30)
 */
export function isEntryRejectedNearDecided(
  fairProbSide: number,
  secondsLeft: number,
  fc: SpeedFeeConfig,
): boolean {
  if (fairProbSide > fc.pricing.fairProbRejectHigh) return true;
  if (fairProbSide < fc.pricing.fairProbRejectLow) return true;
  if (
    secondsLeft < 30 &&
    Math.abs(fairProbSide - 0.5) > fc.pricing.late30sImbalanceReject
  ) {
    return true;
  }
  return false;
}

/**
 * Mig 0028: predicate for cashout-side near-decided gating.
 * In last 30s, reject when |mark − 0.5| > cashoutLate30sImbalanceReject.
 */
export function isCashoutRejectedNearDecided(
  markProb: number,
  secondsLeft: number,
  fc: SpeedFeeConfig,
): boolean {
  return (
    secondsLeft < 30 &&
    Math.abs(markProb - 0.5) > fc.pricing.cashoutLate30sImbalanceReject
  );
}

/**
 * Offered probability — fair probability adjusted by a spread that widens
 * quadratically as fair approaches 0 or 1, then SCALED by the multiplicative
 * late-window factor (mig 0028).
 *
 *   distance = |fair − 0.5|
 *   overage  = max(0, distance − 0.45)
 *   spread   = (base_spread + overage² × extreme_coeff) × spread_mult(s)
 *   offered  = fair + spread/2
 *
 * Output clipped to [0.03, 0.97] to match the mig 0028 hard-reject thresholds
 * (was [0.01, 0.99] pre-mig-0028; the new clip prevents display from drifting
 * into the rejected zone).
 */
export function speedOfferedProb(
  fairProbOver: number,
  side: SpeedSide,
  fc: SpeedFeeConfig,
  secondsLeft: number | null = null,
): number {
  const fair = side === "over" ? fairProbOver : 1 - fairProbOver;
  const distance = Math.abs(fair - 0.5);
  const overage = Math.max(0, distance - 0.45);
  const baseWidened =
    fc.pricing.spreadPct + overage * overage * fc.pricing.extremeSpreadCoeff;
  const mult =
    secondsLeft === null ? 1.0 : speedSpreadMultiplier(secondsLeft, fc);
  const widenedSpread = baseWidened * mult;
  const offered = fair + widenedSpread / 2;
  return Math.max(0.03, Math.min(0.97, offered));
}

/**
 * Duration → seconds. Used for `secondsTotal` in time-bucket calc.
 */
export function durationToSeconds(d: SpeedDuration): number {
  switch (d) {
    case "5m":
      return 5 * 60;
    case "1h":
      return 60 * 60;
  }
}

/**
 * Format seconds remaining as a UI countdown.
 *   5m markets → "0:47"
 *   1h → "12:34" or "1h 0m" right at the start
 */
export function formatSpeedCountdown(secondsLeft: number): string {
  if (secondsLeft < 0) secondsLeft = 0;
  if (secondsLeft >= 3600) {
    const h = Math.floor(secondsLeft / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(secondsLeft / 60);
  const s = Math.floor(secondsLeft % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** True when countdown should switch to urgent styling (<20% remaining). */
export function isUrgent(secondsTotal: number, secondsLeft: number): boolean {
  if (secondsTotal <= 0) return true;
  return secondsLeft / secondsTotal < 0.2;
}

/**
 * Returns true when a market's `opens_at` aligns to a clean clock boundary
 * for its duration. Cron-created markets always do (mig 341 +
 * `_next_clean_boundary`). Test-created markets typically don't.
 *
 * Used by frontend queries to filter out leaked test markets so the live UI
 * only shows real, on-schedule rounds.
 *
 * Boundaries (UTC):
 *   5m  → minute % 5 === 0, sec/ms === 0
 *   1h  → minute === 0, sec/ms === 0
 */
export function isMarketAligned(
  opensAt: string | Date,
  duration: SpeedDuration,
): boolean {
  const ts = typeof opensAt === "string" ? new Date(opensAt) : opensAt;
  if (ts.getUTCSeconds() !== 0 || ts.getUTCMilliseconds() !== 0) return false;
  const minutes = ts.getUTCMinutes();
  switch (duration) {
    case "5m":
      return minutes % 5 === 0;
    case "1h":
      return minutes === 0;
  }
}
