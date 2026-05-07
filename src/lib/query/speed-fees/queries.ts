// W7 cutover: Drizzle/RDS-backed via /api/fees + /api/speed/volatility.
// Mig 0028+: pricing engine v2. The cashout decay matrix and additive
// late-window surcharge keys were deleted; replaced by 8 profit-based
// margin keys, multiplicative spread mults, hard-reject thresholds, and
// soft-guard knobs. This file parses all of them out of fee_config.

/**
 * Realized volatility snapshot for a single asset, surfaced by
 * `get_speed_volatility(asset)`. The oracle worker writes the cache;
 * source is "cache" when fresh, "fallback" when stale or missing.
 */
export interface SpeedRealizedVol {
  rv: number;
  computedAt: string;
  source: "cache" | "fallback";
}

/**
 * Mig 0028 cashout margin parameters (option C profit-based formula).
 * margin = base + saturation/desperation premium + late_window premium
 * Defaults match the migration's INSERTs; admin-tunable from /admin/fees.
 */
export interface SpeedCashoutMargins {
  /** Winning-side base margin per duration. */
  winningBase5m: number;
  winningBase1h: number;
  /** Losing-side base margin per duration. */
  losingBase5m: number;
  losingBase1h: number;
  /** Coefficient on |mark − 0.5| for winning saturation premium. */
  saturationCoef: number;
  /** Coefficient on (0.5 − mark) for losing desperation premium. */
  desperationCoef: number;
  /** Late-window coefficient for winning side ((60 − s)/60 ramp). */
  lateWindowWinningCoef: number;
  /** Late-window coefficient for losing side ((60 − s)/60 ramp). */
  lateWindowLosingCoef: number;
}

/**
 * Mig 0028 + 0031 + 0034: pricing knobs that gate trade entry / cashout / spread.
 */
export interface SpeedPricingConfig {
  /** Base spread (mig 0028: default 0.05 = 5%). */
  spreadPct: number;
  /** Spread multiplier when secondsLeft ∈ [30, 60). Mig 0034: reduced 1.4 → 1.2. */
  late60sSpreadMult: number;
  /** Spread multiplier when secondsLeft < 30. Mig 0034: reduced 1.8 → 1.4. */
  late30sSpreadMult: number;
  /** Reject entry when fair_prob_side > this. Mig 0028 replaces 0.99 clamp. */
  fairProbRejectHigh: number;
  /** Reject entry when fair_prob_side < this. */
  fairProbRejectLow: number;
  /** In last 30s, reject entry when |fair − 0.5| > this. */
  late30sImbalanceReject: number;
  /** In last 30s, reject cashout when |mark − 0.5| > this. */
  cashoutLate30sImbalanceReject: number;
  /** Reject cashout when secondsLeft < this (mig 0028: tightened 5 → 10). */
  cashoutLateRejectS: number;
  /** Drift tolerance on client-supplied IV for stale-quote detection. */
  ivDriftTolerancePct: number;
  /** Oracle freshness gate (server-authoritative; client mirrors for UX). */
  oracleStaleSeconds: number;
  /** Quadratic widening coefficient on offered-prob spread (Seam 3). */
  extremeSpreadCoeff: number;
  /** Mig 0034: matrix-based pricing master switch (server-enforced). */
  matrixEnabled: boolean;
  /** Mig 0034: asymmetric only-push-up rule. */
  asymPushupEnabled: boolean;
  /** Mig 0034: soft-block enabled flag. */
  entrySoftBlockEnabled: boolean;
  /** Mig 0034: soft-block threshold — UI greys trade button when offered_prob >= this. */
  entrySoftBlockThreshold: number;
  /** Mig 0034: hysteresis unlock threshold. */
  entrySoftBlockUnlockThreshold: number;
  /** Mig 0034: cashout cap-edge threshold. UI shows "Hold for settlement" when both entry and mark >= this. */
  cashoutCapEdgeThreshold: number;
}

/**
 * Mig 0028 + 0031 + 0034: per-pool and per-user risk caps.
 */
export interface SpeedRiskCaps {
  /** Pool collateral in USD (cap baseline). */
  poolCollateralUsd: number;
  /** Per-side cap as fraction of pool collateral. */
  perSideCapPct: number;
  /** Per-user-per-market-per-side cap in USD. */
  perUserPerMarketCapUsd: number;
  /** Same-strike-cluster cap as fraction of pool collateral. */
  sameStrikeClusterCapPct: number;
  /** Daily NGR floor — circuit breaker halts new entries when crossed. */
  dailyNgrFloorUsd: number;
  /** Mig 0034: per-ticket gross payout cap for 5m markets. */
  entryMaxPayoutUsd5m: number;
  /** Mig 0034: per-ticket gross payout cap for 1h markets. */
  entryMaxPayoutUsd1h: number;
  /** Mig 0034: NGR alert threshold (telemetry). */
  dailyNgrAlertUsd: number;
  /** Mig 0034: NGR soft-block threshold (reduces per-trade max). */
  dailyNgrSoftBlockUsd: number;
  /** Mig 0034: NGR hard-stop threshold (pauses trading). */
  dailyNgrHardStopUsd: number;
  /** Mig 0034: per-trade stake max during NGR soft-block tier. */
  ngrSoftBlockStakeMaxUsd: number;
}

/**
 * Mig 0031: soft guards (replace daily wager cap).
 * Velocity + open-exposure HARD reject; daily-handle is alert-only.
 */
export interface SpeedSoftGuards {
  /** Bets per minute cap (hard reject). */
  velocityMax: number;
  /** Per-user open-exposure cap as fraction of pool (hard reject). */
  openExposurePct: number;
  /** Per-user daily handle alert threshold in USD (telemetry only). */
  dailyHandleAlert: number;
}

export interface SpeedFeeConfig {
  /** Implied volatility per asset for client-side Black-Scholes pricing. */
  iv: Record<string, number>;
  /**
   * Live realized-volatility snapshot per asset. Source of truth for client
   * pricing when fresh; falls back to `iv` when null. Server reads from
   * `speed_volatility_cache` via `_speed_get_iv()` (mig 0029).
   */
  realizedVol: Record<string, SpeedRealizedVol> | null;
  /** Kill-switch: when false, server bypasses RV cache and reads speed_iv_btc. */
  useRealizedVol: boolean;
  /** Mig 0028 pricing knobs. */
  pricing: SpeedPricingConfig;
  /** Mig 0028 cashout margin parameters (option C). */
  cashoutMargins: SpeedCashoutMargins;
  /** Mig 0028 + 0031 risk caps. */
  riskCaps: SpeedRiskCaps;
  /** Mig 0031 soft guards. */
  softGuards: SpeedSoftGuards;
  /** Per-duration stake bounds (admin-tunable, mig 0027+). */
  stakeMaxByDuration: Record<string, number>;
  /** Per-side cap in USD (legacy compat — same as riskCaps.perUserPerMarketCapUsd). */
  capPerSideUsd: number;
}

export const DEFAULT_SPEED_FEE_CONFIG: SpeedFeeConfig = {
  iv: { BTC: 0.6 },
  realizedVol: null,
  useRealizedVol: true,
  pricing: {
    spreadPct: 0.05,
    // Mig 0034: reduced from 1.4/1.8 — matrix encodes directional kill-zone
    late60sSpreadMult: 1.2,
    late30sSpreadMult: 1.4,
    fairProbRejectHigh: 0.97,
    fairProbRejectLow: 0.03,
    late30sImbalanceReject: 0.3,
    cashoutLate30sImbalanceReject: 0.3,
    cashoutLateRejectS: 10,
    ivDriftTolerancePct: 0.1,
    oracleStaleSeconds: 2,
    extremeSpreadCoeff: 8,
    // Mig 0034 defaults — flags OFF until admin enables
    matrixEnabled: false,
    asymPushupEnabled: true,
    entrySoftBlockEnabled: false,
    entrySoftBlockThreshold: 0.95,
    entrySoftBlockUnlockThreshold: 0.94,
    cashoutCapEdgeThreshold: 0.985,
  },
  cashoutMargins: {
    winningBase5m: 0.025,
    winningBase1h: 0.03,
    losingBase5m: 0.08,
    losingBase1h: 0.09,
    saturationCoef: 0.2,
    desperationCoef: 0.4,
    lateWindowWinningCoef: 0.015,
    lateWindowLosingCoef: 0.05,
  },
  riskCaps: {
    poolCollateralUsd: 100000,
    perSideCapPct: 0.25,
    perUserPerMarketCapUsd: 200,
    sameStrikeClusterCapPct: 0.3,
    dailyNgrFloorUsd: -500,
    // Mig 0034 defaults
    entryMaxPayoutUsd5m: 2500,
    entryMaxPayoutUsd1h: 5000,
    dailyNgrAlertUsd: -500,
    dailyNgrSoftBlockUsd: -2500,
    dailyNgrHardStopUsd: -5000,
    ngrSoftBlockStakeMaxUsd: 100,
  },
  softGuards: {
    velocityMax: 30,
    openExposurePct: 0.15,
    dailyHandleAlert: 5000,
  },
  stakeMaxByDuration: { "5m": 25, "1h": 50 },
  capPerSideUsd: 200,
};

interface FeesResponse {
  fees: Array<{ fee_type: string; rate: number; description: string | null }>;
}

interface VolatilityResponse {
  rv: number | string;
  computed_at: string;
  source: string;
}

export async function fetchSpeedFeeConfig(): Promise<SpeedFeeConfig> {
  // Pull fee_config + RV snapshot in parallel — they're independent endpoints.
  const [feesRes, volRes] = await Promise.all([
    fetch("/api/fees"),
    fetch("/api/speed/volatility?asset=BTC"),
  ]);

  if (!feesRes.ok) throw new Error(`Failed to load fees (${feesRes.status})`);
  const feesJson: FeesResponse = await feesRes.json();

  // Start from defaults; overlay any keys present in fee_config.
  const config: SpeedFeeConfig = JSON.parse(
    JSON.stringify(DEFAULT_SPEED_FEE_CONFIG)
  );
  let useRealizedVolFlag = DEFAULT_SPEED_FEE_CONFIG.useRealizedVol;

  for (const row of feesJson.fees ?? []) {
    if (!row.fee_type.startsWith("speed_") && row.fee_type !== "withdrawal_fee") {
      continue;
    }
    const k = row.fee_type;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate)) continue;

    // IV per asset
    if (k.startsWith("speed_iv_") && !k.startsWith("speed_iv_drift_")) {
      const asset = k.slice("speed_iv_".length).toUpperCase();
      config.iv[asset] = rate;
      continue;
    }

    // Pricing knobs
    switch (k) {
      case "speed_spread_pct":
        config.pricing.spreadPct = rate;
        continue;
      case "speed_extreme_spread_coeff":
        config.pricing.extremeSpreadCoeff = rate;
        continue;
      case "speed_use_realized_vol":
        useRealizedVolFlag = rate !== 0;
        continue;
      case "speed_late_60s_spread_mult":
        config.pricing.late60sSpreadMult = rate;
        continue;
      case "speed_late_30s_spread_mult":
        config.pricing.late30sSpreadMult = rate;
        continue;
      case "speed_fair_prob_reject_high":
        config.pricing.fairProbRejectHigh = rate;
        continue;
      case "speed_fair_prob_reject_low":
        config.pricing.fairProbRejectLow = rate;
        continue;
      case "speed_late_30s_imbalance_reject":
        config.pricing.late30sImbalanceReject = rate;
        continue;
      case "speed_cashout_late_30s_imbalance_reject":
        config.pricing.cashoutLate30sImbalanceReject = rate;
        continue;
      case "speed_cashout_late_reject_s":
        config.pricing.cashoutLateRejectS = rate;
        continue;
      case "speed_iv_drift_tolerance_pct":
        config.pricing.ivDriftTolerancePct = rate;
        continue;
      case "speed_oracle_stale_seconds":
        config.pricing.oracleStaleSeconds = rate;
        continue;
      // Mig 0034: matrix + soft-block + cap-edge
      case "speed_pricing_matrix_enabled":
        config.pricing.matrixEnabled = rate !== 0;
        continue;
      case "speed_pricing_asym_pushup_enabled":
        config.pricing.asymPushupEnabled = rate !== 0;
        continue;
      case "speed_entry_soft_block_enabled":
        config.pricing.entrySoftBlockEnabled = rate !== 0;
        continue;
      case "speed_entry_soft_block_threshold":
        config.pricing.entrySoftBlockThreshold = rate;
        continue;
      case "speed_entry_soft_block_unlock_threshold":
        config.pricing.entrySoftBlockUnlockThreshold = rate;
        continue;
      case "speed_cashout_cap_edge_threshold":
        config.pricing.cashoutCapEdgeThreshold = rate;
        continue;
    }

    // Cashout margins (mig 0028)
    switch (k) {
      case "speed_cashout_winning_base_5m":
        config.cashoutMargins.winningBase5m = rate;
        continue;
      case "speed_cashout_winning_base_1h":
        config.cashoutMargins.winningBase1h = rate;
        continue;
      case "speed_cashout_losing_base_5m":
        config.cashoutMargins.losingBase5m = rate;
        continue;
      case "speed_cashout_losing_base_1h":
        config.cashoutMargins.losingBase1h = rate;
        continue;
      case "speed_cashout_saturation_coef":
        config.cashoutMargins.saturationCoef = rate;
        continue;
      case "speed_cashout_desperation_coef":
        config.cashoutMargins.desperationCoef = rate;
        continue;
      case "speed_cashout_late_window_winning_coef":
        config.cashoutMargins.lateWindowWinningCoef = rate;
        continue;
      case "speed_cashout_late_window_losing_coef":
        config.cashoutMargins.lateWindowLosingCoef = rate;
        continue;
    }

    // Risk caps
    switch (k) {
      case "speed_pool_collateral_usd":
        config.riskCaps.poolCollateralUsd = rate;
        continue;
      case "speed_per_side_cap_pct":
        config.riskCaps.perSideCapPct = rate;
        continue;
      case "speed_per_user_per_market_cap_usd":
        config.riskCaps.perUserPerMarketCapUsd = rate;
        config.capPerSideUsd = rate;
        continue;
      case "speed_cap_per_side_usd":
        // legacy / alternate key name from mig 0027 — same semantic
        config.capPerSideUsd = rate;
        config.riskCaps.perUserPerMarketCapUsd = rate;
        continue;
      case "speed_same_strike_cluster_cap_pct":
        config.riskCaps.sameStrikeClusterCapPct = rate;
        continue;
      case "speed_daily_ngr_floor_usd":
        config.riskCaps.dailyNgrFloorUsd = rate;
        continue;
      // Mig 0034: per-ticket payout caps + three-tier NGR breaker
      case "speed_entry_max_payout_usd_5m":
        config.riskCaps.entryMaxPayoutUsd5m = rate;
        continue;
      case "speed_entry_max_payout_usd_1h":
        config.riskCaps.entryMaxPayoutUsd1h = rate;
        continue;
      case "speed_daily_ngr_alert_usd":
        config.riskCaps.dailyNgrAlertUsd = rate;
        continue;
      case "speed_daily_ngr_soft_block_usd":
        config.riskCaps.dailyNgrSoftBlockUsd = rate;
        continue;
      case "speed_daily_ngr_hard_stop_usd":
        config.riskCaps.dailyNgrHardStopUsd = rate;
        continue;
      case "speed_ngr_soft_block_stake_max_usd":
        config.riskCaps.ngrSoftBlockStakeMaxUsd = rate;
        continue;
    }

    // Soft guards (mig 0031)
    switch (k) {
      case "speed_per_user_velocity_max":
        config.softGuards.velocityMax = rate;
        continue;
      case "speed_per_user_open_exposure_pct":
        config.softGuards.openExposurePct = rate;
        continue;
      case "speed_per_user_daily_handle_alert":
        config.softGuards.dailyHandleAlert = rate;
        continue;
    }

    // Stake bounds (per duration)
    if (k.startsWith("speed_stake_max_") && k.endsWith("_usd")) {
      const dur = k.slice("speed_stake_max_".length, -"_usd".length);
      config.stakeMaxByDuration[dur] = rate;
      continue;
    }
  }

  config.useRealizedVol = useRealizedVolFlag;

  // Best-effort RV snapshot.
  if (volRes.ok) {
    const raw = (await volRes.json()) as VolatilityResponse;
    const rv = Number(raw.rv);
    const source = raw.source === "cache" ? "cache" : "fallback";
    if (Number.isFinite(rv)) {
      config.realizedVol = { BTC: { rv, computedAt: raw.computed_at, source } };
    }
  }

  return config;
}
