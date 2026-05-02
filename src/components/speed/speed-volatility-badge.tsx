"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import type { SpeedAsset } from "@/types/database";

/**
 * Speed market volatility badge — compact LOW / NORMAL / HIGH chip showing
 * the latest realized-volatility (σ) from `speed_realized_vol_cache` (mig 352
 * Seam 4). When the kill switch is off (`fee_config.speed_use_realized_vol = 0`)
 * or the cache is empty/stale and the server falls back to constant IV, the
 * badge hides — there's nothing meaningful to show.
 *
 * Buckets (annualized σ):
 *   σ < 0.4     → LOW (calm)
 *   0.4 ≤ σ < 1.0 → NORMAL
 *   σ ≥ 1.0     → HIGH (volatile)
 *
 * Tooltip explains "spreads adjust automatically" so users understand why
 * offered prices are wider during a HIGH bucket.
 */
export function SpeedVolatilityBadge({
  asset,
  className,
}: {
  asset: SpeedAsset;
  className?: string;
}) {
  const t = useTranslations("speed.volatility");
  const { realizedVol, useRealizedVol } = useSpeedFeeConfig();

  // Hide when kill switch is off OR no live RV snapshot — nothing to show.
  if (!useRealizedVol) return null;
  const snapshot = realizedVol?.[asset];
  if (!snapshot) return null;

  // Hide when the server is currently falling back to constant IV.
  // The badge only earns its place when σ reflects real market activity.
  if (snapshot.source !== "cache") return null;

  const sigma = snapshot.rv;
  const bucket: "low" | "normal" | "high" =
    sigma < 0.4 ? "low" : sigma >= 1.0 ? "high" : "normal";

  const label = t(bucket);
  const tooltip = t(`tooltip.${bucket}`);

  const palette =
    bucket === "high"
      ? "bg-warning/10 text-warning ring-warning/30"
      : bucket === "low"
        ? "bg-success/10 text-success ring-success/30"
        : "bg-surface text-muted-custom ring-border-custom";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 tabular-nums",
        palette,
        className,
      )}
      title={tooltip}
      aria-label={`${t("ariaLabel")}: ${label}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          bucket === "high"
            ? "bg-warning animate-pulse"
            : bucket === "low"
              ? "bg-success"
              : "bg-muted-custom",
        )}
      />
      {label}
    </span>
  );
}
