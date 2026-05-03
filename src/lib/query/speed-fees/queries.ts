// W7 cutover: Drizzle/RDS-backed via /api/fees + /api/speed/volatility.

/**
 * Realized volatility snapshot for a single asset, surfaced by
 * `get_speed_volatility(asset)`. v1 always returns `source: "fallback"`
 * since the kline-based RV worker doesn't ship until v2.
 */
export interface SpeedRealizedVol {
  rv: number;
  computedAt: string;
  source: "cache" | "fallback";
}

export interface SpeedFeeConfig {
  /** Implied volatility per asset for client-side Black-Scholes pricing. */
  iv: Record<string, number>;
  /** Total spread (e.g. 0.04 = 4%); offered prob = fair ± spread/2 on each side. */
  spread: number;
  /** Handle fee per bet (e.g. 0.01 = 1%). Display only. */
  handleFee: number;
  /** Cashout multipliers keyed `speed_cashout_<duration>_<role>_<bucket>`. */
  cashoutMultipliers: Record<string, number>;
  /** Quadratic widening coefficient for offered-prob spread. */
  extremeSpreadCoeff: number;
  /** Live realized-volatility snapshot per asset; null if errored / not loaded. */
  realizedVol: Record<string, SpeedRealizedVol> | null;
  /** Kill-switch: when false, server bypasses RV cache and reads speed_iv_btc directly. */
  useRealizedVol: boolean;
}

export const DEFAULT_SPEED_FEE_CONFIG: SpeedFeeConfig = {
  iv: { BTC: 0.6 },
  spread: 0.04,
  handleFee: 0.01,
  cashoutMultipliers: {},
  extremeSpreadCoeff: 8,
  realizedVol: null,
  useRealizedVol: true,
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

  const iv: Record<string, number> = { ...DEFAULT_SPEED_FEE_CONFIG.iv };
  const cashoutMultipliers: Record<string, number> = {};
  let spread = DEFAULT_SPEED_FEE_CONFIG.spread;
  let handleFee = DEFAULT_SPEED_FEE_CONFIG.handleFee;
  let extremeSpreadCoeff = DEFAULT_SPEED_FEE_CONFIG.extremeSpreadCoeff;
  let useRealizedVol = DEFAULT_SPEED_FEE_CONFIG.useRealizedVol;

  for (const row of feesJson.fees ?? []) {
    if (!row.fee_type.startsWith("speed_")) continue;
    const rate = Number(row.rate);
    if (row.fee_type === "speed_spread_pct") {
      spread = rate;
    } else if (row.fee_type === "speed_handle_fee_pct") {
      handleFee = rate;
    } else if (row.fee_type === "speed_extreme_spread_coeff") {
      extremeSpreadCoeff = rate;
    } else if (row.fee_type === "speed_use_realized_vol") {
      useRealizedVol = rate !== 0;
    } else if (row.fee_type.startsWith("speed_iv_")) {
      const asset = row.fee_type.slice("speed_iv_".length).toUpperCase();
      iv[asset] = rate;
    } else if (row.fee_type.startsWith("speed_cashout_")) {
      cashoutMultipliers[row.fee_type] = rate;
    }
  }

  // Best-effort: if /api/speed/volatility errors, surface null rather than
  // throwing. The badge hides and pricing falls back to `iv`.
  let realizedVol: Record<string, SpeedRealizedVol> | null = null;
  if (volRes.ok) {
    const raw = (await volRes.json()) as VolatilityResponse;
    const rv = Number(raw.rv);
    const source = raw.source === "cache" ? "cache" : "fallback";
    if (Number.isFinite(rv)) {
      realizedVol = { BTC: { rv, computedAt: raw.computed_at, source } };
    }
  }

  return {
    iv,
    spread,
    handleFee,
    cashoutMultipliers,
    extremeSpreadCoeff,
    realizedVol,
    useRealizedVol,
  };
}
