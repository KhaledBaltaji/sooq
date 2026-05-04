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

  // Lock the layout: featured = live 5m, grid below = live 1h. The 5m
  // never appears in the grid (no duplication). If only one duration is
  // live, the other slot just hides.
  const fiveMin = markets.find((m) => m.duration === "5m");
  const oneHour = markets.find((m) => m.duration === "1h");

  if (!fiveMin && !oneHour) {
    return (
      <div className="rounded-xl border border-border-custom bg-surface p-8 text-center">
        <p className="text-sm text-muted-custom">
          No speed markets are open right now. New 5-minute and 1-hour BTC
          markets roll on every clean clock boundary.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {fiveMin ? <SpeedHeroCard market={fiveMin} /> : <SpeedHeroCardSkeleton />}
      {oneHour && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <SpeedMarketCard market={oneHour} index={0} />
        </div>
      )}
    </div>
  );
}
