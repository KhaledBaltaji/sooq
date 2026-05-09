"use client";

import { cn } from "@/lib/utils";
import type { SpeedAsset } from "@/types/database";

const STYLES: Record<SpeedAsset, { bg: string; glyph: string; ring: string }> = {
  BTC: {
    bg: "bg-[#F7931A]",
    glyph: "₿",
    ring: "ring-[#F7931A]/30",
  },
  GOLD: {
    // Gold gets a tasteful tone, not a Bitcoin-orange.
    bg: "bg-[#D4AF37]",
    glyph: "Au",
    ring: "ring-[#D4AF37]/30",
  },
};

export function SpeedAssetIcon({
  asset,
  size = "md",
  className,
}: {
  asset: SpeedAsset;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const cfg = STYLES[asset];
  const sizeClass =
    size === "sm" ? "h-7 w-7 text-base" : size === "lg" ? "h-12 w-12 text-2xl" : "h-9 w-9 text-lg";
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-bold text-white shadow-sm",
        cfg.bg,
        sizeClass,
        className,
      )}
      aria-label={asset}
    >
      <span className="leading-none">{cfg.glyph}</span>
    </div>
  );
}
