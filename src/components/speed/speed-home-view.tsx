"use client";

// W10 home layout: featured hero card on top, the rest as a grid below.
// Mirrors the prediction-market home shape ("hero + markets-underneath")
// but speed-only, no LMSR carousel, no category rail (Sooq v1 has one
// asset and three durations — no horizontal scroll needed).

import { SpeedHeroCard, SpeedHeroCardSkeleton } from "./speed-hero-card";
import { SpeedMarketCard } from "./speed-market-card";
import { useSpeedMarkets } from "@/hooks/use-speed-markets";

export function SpeedHomeView() {
  const { markets, loading } = useSpeedMarkets({ asset: "BTC" });

  if (loading) {
    return (
      <div className="space-y-8">
        <SpeedHeroCardSkeleton />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-xl bg-surface"
            />
          ))}
        </div>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-xl border border-border-custom bg-surface p-8 text-center">
        <p className="text-sm text-muted-custom">
          No speed markets are open right now. New 5-minute, 15-minute, and
          24-hour BTC markets roll on every clean clock boundary.
        </p>
      </div>
    );
  }

  // useSpeedMarkets sorts: currently-live first (by closes_at asc), then
  // soonest-upcoming as a single-element fallback. The first entry is the
  // most-urgent → featured hero. The rest go in the grid.
  const [featured, ...rest] = markets;

  return (
    <div className="space-y-8">
      <SpeedHeroCard market={featured} />
      {rest.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {rest.map((market, i) => (
            <SpeedMarketCard key={market.id} market={market} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
