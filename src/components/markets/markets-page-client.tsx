"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { MarketCard } from "@/components/market/market-card";
import { SpeedMarketCard } from "@/components/speed/speed-market-card";
import { useSpeedMarkets } from "@/hooks/use-speed-markets";
import { cn, triggerHapticLight } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { TradeSheetProvider, useTradeSheet } from "@/components/trade/trade-sheet-provider";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import type { MarketWithAmm, AmmState } from "@/types/market";

const STATUS_TABS = ["active", "completed", "allStatuses"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const CATEGORIES = [
  "all",
  "speed",
  "politics",
  "economy",
  "sports",
  "tech",
  "entertainment",
] as const;

function MarketsPageInner({
  initialMarkets,
}: {
  initialMarkets: MarketWithAmm[];
}) {
  const t = useTranslations("markets");
  const supabase = useSupabase();
  const { openTrade } = useTradeSheet();
  const isDesktop = useIsDesktop();
  const [markets, setMarkets] = useState(initialMarkets);
  const [activeTab, setActiveTab] = useState<StatusTab>("active");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const { markets: openSpeed } = useSpeedMarkets({ asset: "BTC" });

  useEffect(() => {
    const channel = supabase
      .channel("all-markets-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets" },
        (payload) => {
          const updated = payload.new as MarketWithAmm;
          if (payload.eventType === "UPDATE") {
            setMarkets((prev) =>
              prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
            );
          } else if (payload.eventType === "INSERT") {
            setMarkets((prev) => [updated, ...prev]);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "amm_state" },
        (payload) => {
          const amm = payload.new as AmmState;
          setMarkets((prev) =>
            prev.map((m) =>
              m.id === amm.market_id ? { ...m, amm_state: amm } : m
            )
          );
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Markets page realtime subscription error");
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  const marketsByTab =
    activeTab === "active"
      ? markets.filter((m) => m.status === "open")
      : activeTab === "completed"
        ? markets.filter((m) => m.status === "resolved" || m.status === "voided")
        : markets;

  const filteredPredictions =
    activeCategory === "all"
      ? marketsByTab
      : activeCategory === "speed"
        ? []
        : marketsByTab.filter((m) => {
            const cat = m.category?.toLowerCase();
            return cat === activeCategory || (activeCategory === "economy" && cat === "economics");
          });

  // Speed cards only render in "Active" view (they're inherently live).
  // Show under "all" (leading) or "speed" (alone).
  const showSpeed =
    activeTab === "active" && (activeCategory === "all" || activeCategory === "speed");
  const visibleSpeed = showSpeed ? openSpeed : [];

  const isEmpty = filteredPredictions.length === 0 && visibleSpeed.length === 0;

  return (
    <div className="pt-8 pb-12">
      {/* Header — status segmented control floats right on md+ */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-satoshi text-2xl font-black text-text">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-custom mt-1">{t("subtitle")}</p>
        </div>
        <div className="hidden md:inline-flex items-center rounded-full bg-surface p-1 text-xs font-bold font-satoshi shrink-0">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { triggerHapticLight(); setActiveTab(tab); }}
              className={cn(
                "px-3 py-1.5 rounded-full whitespace-nowrap transition-colors duration-150 [-webkit-tap-highlight-color:transparent]",
                activeTab === tab
                  ? "bg-elevated text-text"
                  : "text-muted-custom hover:text-text",
              )}
            >
              {t(tab)}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile status segmented control */}
      <div className="md:hidden mb-3 inline-flex items-center rounded-full bg-surface p-1 text-xs font-bold font-satoshi">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { triggerHapticLight(); setActiveTab(tab); }}
            className={cn(
              "px-3 py-1.5 rounded-full whitespace-nowrap transition-colors duration-150 [-webkit-tap-highlight-color:transparent]",
              activeTab === tab
                ? "bg-elevated text-text"
                : "text-muted-custom hover:text-text",
            )}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      {/* Category rail — text-pill style, matches HomeCategoryRail */}
      <div className="mb-8 border-b border-border-custom">
        <div className="flex items-center gap-4 overflow-x-auto hide-scrollbar pb-3 [-webkit-overflow-scrolling:touch]">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => { triggerHapticLight(); setActiveCategory(cat); }}
                className={cn(
                  "shrink-0 whitespace-nowrap font-satoshi text-sm transition-colors duration-150 [-webkit-tap-highlight-color:transparent]",
                  isActive
                    ? "font-black text-text"
                    : "font-medium text-muted-custom hover:text-text",
                )}
              >
                {t(cat)}
              </button>
            );
          })}
        </div>
      </div>

      {isEmpty && (
        <div className="text-center py-16">
          <p className="text-muted-custom text-sm">
            {activeCategory === "all"
              ? t("noMarkets")
              : t("noMarketsInCategory")}
          </p>
        </div>
      )}

      {!isEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleSpeed.map((sm, i) => (
            <SpeedMarketCard key={`speed-${sm.id}`} market={sm} index={i} />
          ))}
          {filteredPredictions.map((market, i) => (
            <MarketCard
              key={market.id}
              market={market}
              index={visibleSpeed.length + i}
              onTradeClick={isDesktop || market.status !== "open" ? undefined : (side) => openTrade(market, side)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketsPageClient({
  initialMarkets,
}: {
  initialMarkets: MarketWithAmm[];
}) {
  return (
    <TradeSheetProvider>
      <MarketsPageInner initialMarkets={initialMarkets} />
    </TradeSheetProvider>
  );
}
