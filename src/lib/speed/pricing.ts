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
 * Continuous cashout multiplier — linear interpolation between the
 * `_low` and `_high` keys in fee_config. Mirrors the server-side
 * `speed_cashout_multiplier(duration, role, pct)` helper added in mig 351.
 *
 * Replaces the bucket-based lookup (high/mid/low) which produced visible
 * cliffs at pct=0.6 and pct=0.2. The `_mid` keys remain in fee_config but
 * are no longer read.
 *
 * Returns `null` if the endpoint keys aren't loaded yet (caller falls back
 * to "—" in the UI). This is intentionally distinct from `0` (which would
 * be a valid multiplier).
 *
 * @param duration Speed market duration ('5m' | '15m' | '1h' | '24h')
 * @param role 'winner' (fair >= entry) or 'loser' (fair < entry)
 * @param pct Fraction of duration remaining = secondsLeft / secondsTotal
 * @param config Speed fee config (uses cashoutMultipliers[*_high|*_low])
 */
export function speedCashoutMultiplier(
  duration: SpeedDuration,
  role: "winner" | "loser",
  pct: number,
  config: SpeedFeeConfig,
): number | null {
  const lowKey = `speed_cashout_${duration}_${role}_low`;
  const highKey = `speed_cashout_${duration}_${role}_high`;
  const low = config.cashoutMultipliers[lowKey];
  const high = config.cashoutMultipliers[highKey];
  if (low === undefined || high === undefined) return null;
  const clampedPct = Math.max(0, Math.min(1, pct));
  return low + (high - low) * clampedPct;
}

/**
 * @deprecated Replaced by `speedCashoutMultiplier` (mig 351). This function
 *   maps a continuous time-remaining ratio to one of three discrete buckets,
 *   which is what produced the cashout-preview cliffs at pct=0.6 / pct=0.2.
 *   The server-side helper is the authoritative source after mig 351.
 *
 *   Kept exported for one release so any external callers (none known
 *   in-tree as of mig 351) don't break instantly. Will be removed in a
 *   follow-up cleanup migration.
 *
 * Time-remaining bucket per the original Round 2.Q3 decision:
 *   high: >=60% of duration left
 *   mid:  20-60% left (inclusive lower)
 *   low:  <20% left
 */
export function speedTimeBucket(
  secondsTotal: number,
  secondsLeft: number,
): "high" | "mid" | "low" {
  if (secondsTotal <= 0) return "low";
  const pct = secondsLeft / secondsTotal;
  if (pct >= 0.6) return "high";
  if (pct >= 0.2) return "mid";
  return "low";
}

/**
 * Late-window surcharge constants — mirror fee_config rows
 * `speed_late_window_threshold` and `speed_late_window_surcharge` set in
 * mig 356. Update both client and server when tuning these dials.
 */
export const LATE_WINDOW_THRESHOLD_SECONDS = 30;
export const LATE_WINDOW_SURCHARGE = 0.15;

/**
 * Returns true when `secondsLeft` is inside the late-window threshold.
 * Used by UI to display the "watch only — last 30s pricing" indicator.
 */
export function isInLateWindow(secondsLeft: number): boolean {
  return secondsLeft < LATE_WINDOW_THRESHOLD_SECONDS;
}

/**
 * Apply the late-window spread surcharge.
 *
 * Mirrors mig 356 helper `speed_apply_late_window_surcharge`:
 *   - When secondsLeft < threshold (default 30): widens spread by surcharge (+15%)
 *   - Otherwise: returns base spread unchanged
 *
 * Applied INSIDE `speedOfferedProb` so the offered prob shown to users in
 * the last 30s reflects the brutal pricing they'll be charged. Casino
 * aesthetic — the button stays clickable but the math punishes it.
 */
export function applyLateWindowSurcharge(
  baseSpread: number,
  secondsLeft: number | null,
): number {
  if (secondsLeft !== null && secondsLeft < LATE_WINDOW_THRESHOLD_SECONDS) {
    return baseSpread + LATE_WINDOW_SURCHARGE;
  }
  return baseSpread;
}

/**
 * Offered probability — fair probability adjusted by a spread that widens
 * quadratically as fair approaches 0 or 1, plus a late-window surcharge in
 * the last 30 seconds before close.
 *
 * Mig 352 (Seam 3): no longer returns `null`. The server-side reject
 * ("Market too imbalanced") is gone — the trade button stays enabled and
 * the spread widens instead.
 *
 * Mig 356: late-window surcharge in last 30s. Adds +15% spread on top of
 * Seam 3 widening when secondsLeft < 30. User EV becomes negative at every
 * fair_prob level. Pass `secondsLeft` to enable; `null` keeps surcharge off.
 *
 * Formula (mirrors `speed_execute_trade` body in mig 356):
 *   distance = |fair - 0.5|                        // 0 at 50/50, 0.5 at extreme
 *   overage  = max(0, distance - 0.45)             // kicks in past ±0.45 from center
 *   spread   = base_spread + overage² × extreme_coeff
 *   spread  += late_window_surcharge if secondsLeft < 30
 *   offered  = fair + spread/2, clamped to [0.01, 0.99]
 *
 * With base_spread = 0.04, extremeCoeff = 8, surcharge = 0.15:
 *   fair = 0.50, secondsLeft = 60   → offered = 0.52       (1.92x payout)
 *   fair = 0.50, secondsLeft = 15   → offered = 0.595      (1.68x payout — surcharge active)
 *   fair = 0.96, secondsLeft = 15   → offered = 0.99 (cap) (1.01x payout — surcharge active)
 */
export function speedOfferedProb(
  fairProbOver: number,
  side: SpeedSide,
  spread: number = 0.04,
  extremeCoeff: number = 8,
  secondsLeft: number | null = null,
): number {
  const fair = side === "over" ? fairProbOver : 1 - fairProbOver;
  const distance = Math.abs(fair - 0.5);
  const overage = Math.max(0, distance - 0.45);
  let widenedSpread = spread + overage * overage * extremeCoeff;
  // Mig 356: late-window surcharge applies after Seam 3 widening
  widenedSpread = applyLateWindowSurcharge(widenedSpread, secondsLeft);
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
    case "15m":
      return 15 * 60;
    case "1h":
      return 60 * 60;
    case "24h":
      return 24 * 60 * 60;
  }
}

/**
 * Format seconds remaining as a UI countdown.
 *   5m markets → "0:47"
 *   15m / 1h → "12:34"
 *   24h → "23h 12m"
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
 *   15m → minute % 15 === 0, sec/ms === 0
 *   1h  → minute === 0, sec/ms === 0
 *   24h → hour === 0, minute === 0, sec/ms === 0
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
    case "15m":
      return minutes % 15 === 0;
    case "1h":
      return minutes === 0;
    case "24h":
      return minutes === 0 && ts.getUTCHours() === 0;
  }
}
