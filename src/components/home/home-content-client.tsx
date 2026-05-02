"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { HeroMarketCard } from "@/components/market/hero-market-card";
import { FeaturedMarketsCarousel } from "@/components/home/featured-markets-carousel";
import { AllMarketsFeed } from "@/components/home/all-markets-feed";
import { SpeedMarketsFeed } from "@/components/speed/speed-markets-feed";
import { useSpeedMarkets } from "@/hooks/use-speed-markets";
import { BottomSections } from "@/components/home/bottom-sections";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { TradeSheetProvider, useTradeSheet } from "@/components/trade/trade-sheet-provider";
import { useTranslations } from "next-intl";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { HowItWorksBanner } from "@/components/home/how-it-works-banner";
import { HomeCategoryRail, type HomeCategory } from "@/components/home/home-category-rail";
import { PortfolioSidebar } from "@/components/layout/portfolio-sidebar";
import { HowItWorks } from "@/components/home/how-it-works";
import type { MarketWithAmm, AmmState } from "@/types/market";

function HomeInner({
  initialMarkets,
  refetchRef,
  fetchFailed,
}: {
  initialMarkets: MarketWithAmm[];
  refetchRef: React.MutableRefObject<(() => Promise<void>) | null>;
  fetchFailed: boolean;
}) {
  const supabase = useSupabase();
  const t = useTranslations("market");
  const tMarkets = useTranslations("markets");
  const { openTrade } = useTradeSheet();
  const isDesktop = useIsDesktop();
  const [markets, setMarkets] = useState(initialMarkets);
  const [retried, setRetried] = useState(false);
  const [activeCategory, setActiveCategory] = useState<HomeCategory>("all");
  const bailoutFiredRef = useRef(false);

  // Keep markets fresh via realtime
  useEffect(() => {
    const channel = supabase
      .channel("home-markets-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets" },
        (payload) => {
          const updated = payload.new as MarketWithAmm;
          if (payload.eventType === "UPDATE") {
            if (updated.status !== "open") {
              setMarkets((prev) => prev.filter((m) => m.id !== updated.id));
            } else {
              setMarkets((prev) =>
                prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
              );
            }
          } else if (payload.eventType === "INSERT" && updated.status === "open") {
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
          console.error("Home markets realtime subscription error");
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  const refetchMarkets = useCallback(async () => {
    const { data, error } = await supabase
      .from("markets")
      .select("*, amm_state:amm_state(*)")
      .eq("status", "open")
      .gt("closes_at", new Date().toISOString())
      .order("trade_count", { ascending: false });
    if (error) {
      console.error("Failed to refetch markets:", error.message);
      setRetried(true);
      return;
    }
    if (data) setMarkets(data as unknown as MarketWithAmm[]);
    setRetried(true);
  }, [supabase]);

  useEffect(() => {
    refetchRef.current = refetchMarkets;
  }, [refetchRef, refetchMarkets]);

  // One-shot bail-out: if SSR returned empty (either genuine or due to a transient fail),
  // try one refetch from the browser client. The browser client uses a different auth
  // context than the anon SSR client, so it often succeeds when SSR trips on a cold start.
  useEffect(() => {
    if (bailoutFiredRef.current) return;
    if (initialMarkets.length > 0) return;
    bailoutFiredRef.current = true;
    void refetchMarkets();
  }, [initialMarkets.length, refetchMarkets]);

  // Drop markets whose close window has passed — handles in-session expiry without a refresh.
  const now = Date.now();
  const live = markets.filter((m) => new Date(m.closes_at).getTime() > now);

  // Most-urgent open speed market — surfaced as the first slide of the
  // featured carousel so users see it alongside the prediction picks.
  // Only injected when category is "all" — never on Politics/Sports/etc.
  // since BTC is asset-specific, not category-bound.
  const { markets: openSpeed, loading: speedLoading } = useSpeedMarkets({ asset: "BTC" });
  const featuredSpeedMarket =
    activeCategory === "all" && openSpeed.length > 0 ? openSpeed[0] : null;
  // Phase 9i: while the speed-markets fetch is in flight, reserve slot 0
  // in the featured carousel with a skeleton SpeedHeroCard. Prevents the
  // initial paint from briefly landing on the Lebanese-Lira slide and then
  // jumping when speedMarket arrives.
  const featuredSpeedLoading = activeCategory === "all" && speedLoading && !featuredSpeedMarket;

  // Mobile-only category filter (rail is `lg:hidden`); desktop ignores it.
  const byCategory = activeCategory === "all"
    ? live
    : live.filter((m) => {
        const cat = m.category?.toLowerCase();
        return cat === activeCategory || (activeCategory === "economy" && cat === "economics");
      });

  // Sort: ranked first, then by trade_count (server already sorted by trade_count desc)
  const ranked = byCategory.filter((m) => m.homepage_rank != null)
    .sort((a, b) => (a.homepage_rank ?? 0) - (b.homepage_rank ?? 0));
  const unranked = byCategory.filter((m) => m.homepage_rank == null);
  const sorted = ranked.length > 0 ? [...ranked, ...unranked] : byCategory;

  // Desktop ignores the mobile category filter.
  const desktopRanked = live.filter((m) => m.homepage_rank != null)
    .sort((a, b) => (a.homepage_rank ?? 0) - (b.homepage_rank ?? 0));
  const desktopUnranked = live.filter((m) => m.homepage_rank == null);
  const desktopSorted = desktopRanked.length > 0 ? [...desktopRanked, ...desktopUnranked] : live;

  const heroMarket = desktopSorted[0];
  const featuredMarkets = sorted.slice(0, 4);
  const mobileRemaining = sorted;
  const desktopRemaining = desktopSorted.slice(1);

  const showSkeleton = live.length === 0 && fetchFailed && !retried;
  const showRetry = live.length === 0 && fetchFailed && retried;
  const showEmpty = live.length === 0 && !fetchFailed;
  const showCategoryEmpty =
    live.length > 0 && sorted.length === 0 && activeCategory !== "all";

  return (
    <>
      {showSkeleton && (
        <div className="space-y-4 py-8" aria-label={t("loading")}>
          <div className="h-48 rounded-lg bg-elevated/50 animate-pulse" />
          <div className="h-32 rounded-lg bg-elevated/50 animate-pulse" />
          <div className="h-32 rounded-lg bg-elevated/50 animate-pulse" />
        </div>
      )}

      {showRetry && (
        <div className="text-center py-16 space-y-4">
          <p className="text-muted-custom text-sm">{t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => { setRetried(false); void refetchMarkets(); }}
            className="inline-flex items-center justify-center rounded-md border border-border-custom px-4 py-2 text-sm font-medium hover:bg-elevated transition-colors"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {showEmpty && (
        <div className="text-center py-16">
          <p className="text-muted-custom text-sm">{t("noActiveMarkets")}</p>
        </div>
      )}

      {/* Polymarket-style category rail (mobile only).
          NOTE: rendered as a direct child of the home column so position:sticky's
          containing block is the full content height — not a short wrapper. */}
      {live.length > 0 && (
        <HomeCategoryRail active={activeCategory} onChange={setActiveCategory} />
      )}

      {/* "Speed" category dedicates the page to the speed grid. */}
      {activeCategory === "speed" ? (
        <section className="pt-4 mb-12 lg:pt-0">
          <SpeedMarketsFeed />
        </section>
      ) : (
        <>
          {/* Mobile carousel — speed market injected as the leading slide
              (most-urgent open BTC market). Prediction markets fill the rest. */}
          {(featuredMarkets.length > 0 || featuredSpeedMarket || featuredSpeedLoading) && (
            <section className="pt-4 mb-12 lg:pt-0 lg:hidden">
              <FeaturedMarketsCarousel
                markets={featuredMarkets}
                speedMarket={featuredSpeedMarket}
                speedMarketLoading={featuredSpeedLoading}
                onTradeClick={(m, side) => openTrade(m, side)}
              />
            </section>
          )}
          {heroMarket && (
            <section className="mb-12 hidden lg:block">
              <HeroMarketCard
                market={heroMarket}
                onTradeClick={isDesktop ? undefined : (side) => openTrade(heroMarket, side)}
              />
            </section>
          )}

          {showCategoryEmpty && (
            <div className="text-center py-12 lg:hidden">
              <p className="text-muted-custom text-sm">{tMarkets("noMarketsInCategory")}</p>
            </div>
          )}
        </>
      )}

      {/* HowItWorks lives in the right-sidebar (desktop) and the sticky banner (mobile). */}

      {activeCategory !== "speed" && (mobileRemaining.length > 0 || (activeCategory === "all" && openSpeed.length > 0)) && (
        <div className="lg:hidden">
          <AllMarketsFeed
            markets={mobileRemaining}
            speedMarkets={
              activeCategory === "all"
                ? openSpeed.filter((m) => m.id !== featuredSpeedMarket?.id).slice(0, 1)
                : []
            }
          />
        </div>
      )}
      {activeCategory !== "speed" && (desktopRemaining.length > 0 || openSpeed.length > 0) && (
        <div className="hidden lg:block">
          <AllMarketsFeed markets={desktopRemaining} speedMarkets={openSpeed.slice(0, 1)} />
        </div>
      )}

      {live.length > 0 && <BottomSections />}

      {/* Sticky dismissible banner above bottom nav (mobile only) */}
      <HowItWorksBanner />
    </>
  );
}

export function HomeContentClient({
  initialMarkets,
  fetchFailed = false,
}: {
  initialMarkets: MarketWithAmm[];
  fetchFailed?: boolean;
}) {
  const refetchRef = useRef<(() => Promise<void>) | null>(null);

  const handleRefresh = async () => {
    window.location.reload();
  };

  return (
    <TradeSheetProvider refetchMarkets={async () => { await refetchRef.current?.(); }}>
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="pt-0 lg:pt-8 pb-32 lg:pb-12 xl:grid xl:grid-cols-[1fr_320px] xl:gap-6">
          <div className="min-w-0">
            <HomeInner initialMarkets={initialMarkets} refetchRef={refetchRef} fetchFailed={fetchFailed} />
          </div>
          <aside className="hidden xl:flex flex-col gap-4 sticky top-24 self-start">
            <PortfolioSidebar />
            <HowItWorks />
          </aside>
        </div>
      </PullToRefresh>
    </TradeSheetProvider>
  );
}
