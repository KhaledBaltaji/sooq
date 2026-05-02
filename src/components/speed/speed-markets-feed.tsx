"use client";

import { useTranslations } from "next-intl";
import { SpeedMarketCard } from "./speed-market-card";
import { useSpeedMarkets } from "@/hooks/use-speed-markets";

/**
 * Renders the open speed-markets feed for the home page when the user has
 * the "Speed" category chip selected. Sorted by closes_at ascending so
 * the most-urgent market is on top.
 *
 * No live oracle subscription here anymore — speed cards are static (label
 * only) until the user opens the detail page. This shaves a WebSocket
 * channel + per-mount oracle fetch off the home → speed-feed transition.
 */
export function SpeedMarketsFeed() {
  const t = useTranslations("speed");
  const { markets, loading } = useSpeedMarkets({ asset: "BTC" });

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-xl border border-border-custom bg-surface p-8 text-center">
        <p className="text-sm text-muted-custom">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {markets.map((market, i) => (
        <SpeedMarketCard key={market.id} market={market} index={i} />
      ))}
    </div>
  );
}
