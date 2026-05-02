"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SpeedMarket } from "@/types/database";
import { SpeedAssetIcon } from "./speed-asset-icon";

const ASSET_LABELS: Record<string, string> = { BTC: "Bitcoin" };

/**
 * Grid-sized speed market card. Footprint matches the prediction `MarketCard`
 * (h-48 hero + button row) so speed and prediction cards share the same grid
 * cell on home + /markets. Static-only — no oracle subscription, sparkline,
 * countdown, or live percentages until the user opens /speed/<id>.
 */
export function SpeedMarketCard({ market, index = 0 }: { market: SpeedMarket; index?: number }) {
  const assetLabel = ASSET_LABELS[market.asset] ?? market.asset;

  // On desktop the parallel-route intercept matches `/speed/[id]` and renders
  // null (Phase 9h) — but the intercept STILL fires, holding `{children}`
  // on the home route. Net effect: URL changes but the page stays on home.
  // Forcing a full navigation bypasses the intercept entirely so the
  // standalone /speed/[id] page renders correctly on desktop.
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      e.preventDefault();
      window.location.href = `/speed/${market.id}`;
    }
  };

  return (
    <Link
      href={`/speed/${market.id}`}
      onClick={handleClick}
      className={cn(
        "group block bg-surface rounded-xl overflow-hidden",
        "hover:bg-elevated transition-all duration-200",
        "animate-in fade-in slide-in-from-bottom-2",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Hero — matches MarketCard h-48 */}
      <div className="relative h-48 overflow-hidden">
        <div className="w-full h-full bg-gradient-to-br from-warning/25 to-surface" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent" />

        {/* Question + asset icon — bottom of hero, mirrors MarketCard layout */}
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end gap-3">
          <SpeedAssetIcon asset={market.asset} size="lg" />
          <h3 className="flex-1 text-xl font-medium font-satoshi leading-snug text-text drop-shadow-sm">
            {assetLabel}{" "}
            <span className="text-muted-custom">Up or Down ({market.duration})</span>
          </h3>
        </div>
      </div>

      {/* UP / DOWN buttons — matches MarketCard YES/NO row */}
      <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-4">
        <StaticSide label="Up" tone="up" />
        <StaticSide label="Down" tone="down" />
      </div>
    </Link>
  );
}

function StaticSide({ label, tone }: { label: string; tone: "up" | "down" }) {
  const base =
    "flex items-center justify-center py-3 rounded-lg font-satoshi font-black text-white text-base uppercase tracking-wide transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]";
  const upShadow =
    "bg-success shadow-[0_4px_0_0px_rgba(20,90,60,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(20,90,60,0.9)]";
  const downShadow =
    "bg-destructive shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]";
  return (
    <div className={cn(base, tone === "up" ? upShadow : downShadow)}>
      {label}
    </div>
  );
}
