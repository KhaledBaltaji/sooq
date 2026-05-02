"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MarketCard } from "@/components/market/market-card";
import { TradeSheetProvider, useTradeSheet } from "@/components/trade/trade-sheet-provider";
import { useMarkets } from "@/hooks/use-markets";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, triggerHapticLight } from "@/lib/utils";

const STATUS_TABS = ["active", "completed", "allStatuses"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const CATEGORIES = ["all", "politics", "economy", "sports", "tech", "entertainment"] as const;

function DemoMarketsInner() {
  const { markets, loading } = useMarkets();
  const { openTrade } = useTradeSheet();
  const isDesktop = useIsDesktop();
  const t = useTranslations("markets");
  const tDemo = useTranslations("demo");
  const [activeTab, setActiveTab] = useState<StatusTab>("active");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const marketsByTab = useMemo(() => {
    if (activeTab === "active") return markets.filter((m) => m.status === "open");
    if (activeTab === "completed")
      return markets.filter((m) => m.status === "resolved" || m.status === "voided");
    return markets;
  }, [markets, activeTab]);

  const filteredMarkets = useMemo(() => {
    if (activeCategory === "all") return marketsByTab;
    return marketsByTab.filter((m) => {
      const cat = m.category?.toLowerCase();
      return cat === activeCategory || (activeCategory === "economy" && cat === "economics");
    });
  }, [marketsByTab, activeCategory]);

  if (loading && markets.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
      {/* Status tabs — mirrors the live /markets page */}
      <div className="flex gap-1 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              triggerHapticLight();
              setActiveTab(tab);
            }}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-satoshi font-semibold whitespace-nowrap transition-colors",
              activeTab === tab ? "bg-text text-bg" : "text-muted-custom hover:text-text"
            )}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              triggerHapticLight();
              setActiveCategory(cat);
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-satoshi font-medium whitespace-nowrap transition-colors border",
              activeCategory === cat
                ? "bg-text text-bg border-text"
                : "text-muted-custom border-border-custom hover:text-text"
            )}
          >
            {t(cat as (typeof CATEGORIES)[number])}
          </button>
        ))}
      </div>

      {filteredMarkets.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-custom">
          {tDemo("empty.noMarkets")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMarkets.map((market, i) => (
            <MarketCard
              key={market.id}
              market={market}
              index={i}
              hrefPrefix="/demo/market"
              onTradeClick={isDesktop ? undefined : (side) => openTrade(market, side)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DemoMarketsPage() {
  return (
    <TradeSheetProvider>
      <DemoMarketsInner />
    </TradeSheetProvider>
  );
}
