/**
 * Client-side speed-market pricing.
 *
 * Mirrors the Postgres functions defined in mig 318:
 *   - normal_cdf
 *   - speed_fair_prob_over
 *   - speed_time_bucket
 *
 * Used by the trade page to render live OVER/UNDER probabilities and the
 * cashout footer's fair-value preview. The server RPCs always re-compute at
 * commit time (oracle freshness, idempotency); these are display-only.
 */

import type { SpeedDuration, SpeedSide } from "@/types/database";
import type { SpeedFeeConfig } from "@/lib/query/speed-fees/queries";

/**
 * Standard normal CDF — Abramowitz & Stegun 26.2.17 polynomial.
 * Accuracy ~7.5e-8. Pure function.
 *
 * Mirrors mig 352 (Seam 2a): at |x| >= 37 the polynomial result is already
 * indistinguishable from the asymptote (0 or 1) within float64 precision.
 * JS doesn't throw on Math.exp(-722) (it returns 0 silently), but clip
 * anyway for parity with the SQL helper and to avoid relying on that
 * silent-zero behavior.
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
 * Output clipped to [0.01, 0.99] to match mig 357 (which reverts mig 352
 * Seam 2's [0.001, 0.999] widening). The wider clip created a round-trip
 * arbitrage at extreme moneyness because fair could exceed the offered_prob
 * cap of 0.99 — caught by speed-cashout-invariant.test.ts. The "visible flat
 * region" Seam 2 tried to remove is less harmful than the arbitrage; Seam 3's
 * quadratic spread widening still does user-facing work at the edge.
 *
 * @param spot Current asset price
 * @param strike Market strike price
 * @param secondsLeft Time to expiry in seconds (clamped >= 1)
 * @param iv Implied volatility (annualized, e.g. 0.6 for BTC)
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
    // Edge: zero time or zero vol → step function (matches mig 357 SQL clip)
    return spot > strike ? 0.99 : 0.01;
  }
  const d2 = (Math.log(spot / strike) - (iv * iv * yearsLeft) / 2) / sigmaSqrtT;
  const fairProb = normalCdf(d2);
  return Math.max(0.01, Math.min(0.99, fairProb));
}

/**
 * Continuous cashout decay multiplier — duration-specific (mig 369).
 *
 * Mirrors `speed_cashout_multiplier(duration, pct)` in mig 369. One formula
 * for both winners and losers — no role branch, no role-boundary
 * discontinuity. Linear interpolation between five endpoints stored in
 * fee_config as `speed_cashout_decay_<duration>_<bucket>`.
 *
 * Endpoint stop list (in increasing pct):
 *   pct=0.00 → ${dur}_lt20         (anchor at 0% time-left)
 *   pct=0.20 → ${dur}_lt20 / ${dur}_20to40 boundary
 *   pct=0.40 → ${dur}_20to40 / ${dur}_40to60 boundary
 *   pct=0.60 → ${dur}_40to60 / ${dur}_60to80 boundary
 *   pct=0.80 → ${dur}_60to80 / ${dur}_ge80 boundary
 *   pct≥0.80 → ${dur}_ge80 (flat)
 *
 * Returns `null` if endpoints aren't loaded yet — caller renders "—" until
 * fee_config arrives.
 */
export function speedCashoutMultiplier(
  duration: SpeedDuration,
  pct: number,
  config: SpeedFeeConfig,
): number | null {
  const ge80   = config.cashoutMultipliers[`speed_cashout_decay_${duration}_ge80`];
  const _60to80 = config.cashoutMultipliers[`speed_cashout_decay_${duration}_60to80`];
  const _40to60 = config.cashoutMultipliers[`speed_cashout_decay_${duration}_40to60`];
  const _20to40 = config.cashoutMultipliers[`speed_cashout_decay_${duration}_20to40`];
  const lt20   = config.cashoutMultipliers[`speed_cashout_decay_${duration}_lt20`];
  if (
    ge80 === undefined || _60to80 === undefined || _40to60 === undefined ||
    _20to40 === undefined || lt20 === undefined
  ) {
    return null;
  }
  const p = Math.max(0, Math.min(1, pct));
  if (p >= 0.80) return ge80;
  if (p >= 0.60) return _60to80 + (ge80    - _60to80) * ((p - 0.60) / 0.20);
  if (p >= 0.40) return _40to60 + (_60to80 - _40to60) * ((p - 0.40) / 0.20);
  if (p >= 0.20) return _20to40 + (_40to60 - _20to40) * ((p - 0.20) / 0.20);
  return lt20 + (_20to40 - lt20) * (p / 0.20);
}

/**
 * Liquidation discount — applied multiplicatively on top of the decay curve
 * (mig 369). Mirrors `speed_liq_discount(secondsLeft)`. Sharp drops near
 * expiry. < 5s returns 0 — the RPC also rejects, but defense-in-depth.
 */
export function speedLiqDiscount(secondsLeft: number): number {
  if (secondsLeft < 5) return 0;
  if (secondsLeft >= 30) return 1.0;
  if (secondsLeft >= 10) return 0.85;
  return 0.6; // 5-10s
}

/**
 * Mig 369: hard reject window for cashouts (last 5s).
 */
export const CASHOUT_REJECT_WINDOW_SECONDS = 5;

/**
 * Mig 369: 3-tier late-window surcharge on entries.
 * 60s window → +20%, 30s window → +30%, < 10s → reject (handled at call site).
 * Mirrors `speed_late_window_surcharge_pct(secondsLeft)` in mig 369.
 */
export const ENTRY_LATE_WINDOW_60S_PCT = 0.20;
export const ENTRY_LATE_WINDOW_30S_PCT = 0.30;
export const ENTRY_LATE_WINDOW_REJECT_S = 10;

export function isInLateWindow(secondsLeft: number): boolean {
  return secondsLeft < 60;
}

export function entryLateWindowSurchargePct(secondsLeft: number | null): number {
  if (secondsLeft === null) return 0;
  if (secondsLeft < 30) return ENTRY_LATE_WINDOW_30S_PCT;
  if (secondsLeft < 60) return ENTRY_LATE_WINDOW_60S_PCT;
  return 0;
}

/**
 * Returns true when entries are rejected entirely (last 10s).
 */
export function isEntryRejectedLate(secondsLeft: number): boolean {
  return secondsLeft < ENTRY_LATE_WINDOW_REJECT_S;
}

/**
 * Offered probability — fair probability adjusted by a spread that widens
 * quadratically as fair approaches 0 or 1, plus the 3-tier late-window
 * surcharge (mig 369).
 *
 * Mig 369 spec:
 *   distance = |fair - 0.5|
 *   overage  = max(0, distance - 0.45)
 *   spread   = base_spread + overage² × extreme_coeff
 *   spread  += late_window_surcharge_pct(secondsLeft)
 *   offered  = fair + spread/2, clamped to [0.01, 0.99]
 *
 * Default base_spread is 0.05 (mig 369 raised 0.04 → 0.05; absorbed the
 * former 1% phantom handle fee into the spread).
 */
export function speedOfferedProb(
  fairProbOver: number,
  side: SpeedSide,
  spread: number = 0.05,
  extremeCoeff: number = 8,
  secondsLeft: number | null = null,
): number {
  const fair = side === "over" ? fairProbOver : 1 - fairProbOver;
  const distance = Math.abs(fair - 0.5);
  const overage = Math.max(0, distance - 0.45);
  let widenedSpread = spread + overage * overage * extremeCoeff;
  widenedSpread = widenedSpread + entryLateWindowSurchargePct(secondsLeft);
  const offered = fair + widenedSpread / 2;
  return Math.max(0.01, Math.min(0.99, offered));
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

/**
 * Returns true when countdown should switch to urgent styling
 * (<20% of duration remaining). Same threshold as `low` bucket.
 */
export function isUrgent(secondsTotal: number, secondsLeft: number): boolean {
  if (secondsTotal <= 0) return true;
  return secondsLeft / secondsTotal < 0.2;
}

/**
 * Returns true when a market's `opens_at` aligns to a clean clock boundary
 * for its duration. Cron-created markets always do (mig 341 +
 * `_next_clean_boundary`). Test-created markets typically don't (they use
 * `NOW()` directly, leaving sub-second precision and arbitrary minutes).
 *
 * Used by frontend queries to filter out leaked test markets so the live UI
 * only shows real, on-schedule rounds. Defense-in-depth: even if backend
 * cleanup misses something, the UI never displays it.
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
