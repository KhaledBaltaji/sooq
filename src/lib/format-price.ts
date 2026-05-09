/**
 * Per-asset price formatting (Phase 5C / mig 0052).
 *
 * BTC trades around $90,000 — whole dollars are the meaningful precision.
 *   90123 → "$90,123"
 *   90123.45 → "$90,123" (cents are noise)
 *
 * GOLD (PAXG) trades around $2,650 — cents matter for 1m markets where
 * a $0.50 move is a meaningful settlement.
 *   2650.45 → "$2,650.45"
 *   2650 → "$2,650.00"
 *
 * Future assets just add to the mapping.
 */

import type { SpeedAsset } from "@/types/database";

interface AssetFormat {
  /** Number of digits after the decimal point. */
  decimals: number;
  /** "$" prefix. Empty string for tokens that aren't dollar-priced. */
  prefix: string;
}

const ASSET_FORMAT: Record<SpeedAsset, AssetFormat> = {
  BTC: { decimals: 0, prefix: "$" },
  GOLD: { decimals: 2, prefix: "$" },
};

/**
 * Format a price for display.
 * Returns "$90,123" for BTC, "$2,650.45" for GOLD.
 */
export function formatPriceForAsset(asset: SpeedAsset, price: number): string {
  const cfg = ASSET_FORMAT[asset];
  return `${cfg.prefix}${price.toLocaleString("en-US", {
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  })}`;
}

/**
 * Lower-precision format for compact UIs (mini cards). BTC strips cents
 * (already 0); GOLD shows 1 decimal instead of 2.
 *   BTC 90123.45 → "$90,123"
 *   GOLD 2650.45 → "$2,650.5"
 */
export function formatPriceForAssetCompact(
  asset: SpeedAsset,
  price: number,
): string {
  const cfg = ASSET_FORMAT[asset];
  const compactDecimals = Math.max(0, cfg.decimals - 1);
  return `${cfg.prefix}${price.toLocaleString("en-US", {
    minimumFractionDigits: compactDecimals,
    maximumFractionDigits: compactDecimals,
  })}`;
}

/**
 * Decimal precision for a given asset. Useful for Lightweight Charts
 * priceFormat config.
 */
export function priceDecimalsForAsset(asset: SpeedAsset): number {
  return ASSET_FORMAT[asset].decimals;
}
