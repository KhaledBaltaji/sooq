import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Realized volatility snapshot for a single asset, surfaced to the client by
 * the `get_speed_volatility(asset)` RPC (mig 352 Seam 4). `source` is `cache`
 * when the value came from `speed_realized_vol_cache` (fresh, <5min old) or
 * `fallback` when the cache is empty/stale and the server fell back to
 * `fee_config.speed_iv_btc`.
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
  /**
   * Mig 352 (Seam 3): quadratic widening coefficient for offered-prob spread.
   * `spread = base + max(0, |fair - 0.5| - 0.45)² × extremeSpreadCoeff`.
   * Defaults to 8 when fee_config row is missing.
   */
  extremeSpreadCoeff: number;
  /**
   * Mig 352 (Seam 4): live realized-volatility snapshot per asset. Populated
   * by `get_speed_volatility(asset)`. UI can prefer this σ over `iv[asset]`
   * so the displayed offered-prob matches what `speed_execute_trade` will
   * actually price the bet at. `null` when the RPC errored or hasn't loaded.
   */
  realizedVol: Record<string, SpeedRealizedVol> | null;
  /**
   * Mig 352 (Seam 4): kill-switch flag mirrored from fee_config. When `false`,
   * the server bypasses `speed_realized_vol_cache` entirely and reads
   * `fee_config.speed_iv_btc`. UI should hide the volatility badge in that
   * case (or show "static" rather than LOW/NORMAL/HIGH).
   */
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

export async function fetchSpeedFeeConfig(
  supabase: SupabaseClient,
): Promise<SpeedFeeConfig> {
  // Pull the fee_config rows + realized-volatility snapshot in parallel —
  // they're served from different paths (PostgREST table-read vs RPC) so
  // there's no benefit to chaining them.
  const [feeConfigRes, btcVolRes] = await Promise.all([
    supabase
      .from("fee_config")
      .select("fee_type, rate")
      .like("fee_type", "speed_%"),
    supabase
      .rpc("get_speed_volatility", { p_asset: "BTC" })
      .single<{ rv: number | string; computed_at: string; source: string }>(),
  ]);

  if (feeConfigRes.error) throw feeConfigRes.error;

  const iv: Record<string, number> = { ...DEFAULT_SPEED_FEE_CONFIG.iv };
  const cashoutMultipliers: Record<string, number> = {};
  let spread = DEFAULT_SPEED_FEE_CONFIG.spread;
  let handleFee = DEFAULT_SPEED_FEE_CONFIG.handleFee;
  let extremeSpreadCoeff = DEFAULT_SPEED_FEE_CONFIG.extremeSpreadCoeff;
  let useRealizedVol = DEFAULT_SPEED_FEE_CONFIG.useRealizedVol;

  for (const row of (feeConfigRes.data ?? []) as { fee_type: string; rate: number | string }[]) {
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

  // Best-effort: if get_speed_volatility errors (e.g. RPC not deployed yet,
  // or the user is anonymous before mig 352 grants), surface `null` rather
  // than throwing — the badge will hide and pricing will fall back to `iv`.
  let realizedVol: Record<string, SpeedRealizedVol> | null = null;
  if (!btcVolRes.error && btcVolRes.data) {
    const raw = btcVolRes.data;
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
