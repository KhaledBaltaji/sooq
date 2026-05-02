"use client";

import { cn } from "@/lib/utils";
import type { SpeedMarketStatus } from "@/types/database";

/**
 * Stat row rendered between SpeedAssetHeader and SpeedPriceChart.
 *
 * Open markets: Target Price | Live Price (two-cell strip)
 * Resolved markets: Resolved Price (single value, TWAP) — no target, no divider.
 */
export function SpeedTargetStatRow({
  targetPrice,
  livePrice,
  twap,
  isStale,
  status,
}: {
  targetPrice: number;
  livePrice: number | null;
  twap?: number | null;
  isStale: boolean;
  status?: SpeedMarketStatus;
}) {
  const isResolved = status === "resolved" && twap != null;

  if (isResolved) {
    return (
      <div className="bg-bg py-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
          Resolved Price
        </div>
        <div className="font-satoshi text-xl font-extrabold tabular-nums text-text">
          ${twap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      </div>
    );
  }

  const delta = livePrice !== null ? livePrice - targetPrice : null;
  const isUp = delta !== null && delta > 0;
  const isDown = delta !== null && delta < 0;

  return (
    <div className="grid grid-cols-[auto_1fr] gap-px bg-border-custom">
      <div className="bg-bg py-3 pr-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
          Target Price
        </div>
        <div className="font-satoshi text-base font-extrabold tabular-nums text-text">
          ${targetPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      </div>

      <div className="bg-bg py-3 pl-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
          Live Price
        </div>
        <div
          className={cn(
            "font-satoshi text-xl font-extrabold tabular-nums",
            isStale ? "text-muted-custom" : isUp ? "text-success" : isDown ? "text-destructive" : "text-text",
          )}
        >
          {livePrice !== null
            ? `$${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : "—"}
        </div>
      </div>
    </div>
  );
}
