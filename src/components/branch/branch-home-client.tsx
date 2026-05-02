"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { HeroMarketCard } from "@/components/market/hero-market-card";
import { AllMarketsFeed } from "@/components/home/all-markets-feed";
import { BottomSections } from "@/components/home/bottom-sections";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { TradeSheetProvider, useTradeSheet } from "@/components/trade/trade-sheet-provider";
import { useTranslations } from "next-intl";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { HowItWorks } from "@/components/home/how-it-works";
import type { MarketWithAmm, AmmState } from "@/types/market";

interface BranchHomeClientProps {
  initialMarkets: MarketWithAmm[];
  branchCode: string;
}

function BranchHomeInner({
  initialMarkets,
  branchCode,
  refetchRef,
}: {
  initialMarkets: MarketWithAmm[];
  branchCode: string;
  refetchRef: React.MutableRefObject<(() => Promise<void>) | null>;
}) {
  const supabase = useSupabase();
  const t = useTranslations("market");
  const { openTrade } = useTradeSheet();
  const isDesktop = useIsDesktop();
  const [markets, setMarkets] = useState(() => initialMarkets.filter((m) => m.status === "open"));
  const hrefPrefix = `/b/${branchCode}/market`;

  // Keep markets fresh via realtime
  useEffect(() => {
    const channel = supabase
      .channel("branch-markets-realtime")
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
          console.error("Branch markets realtime subscription error");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const refetchMarkets = useCallback(async () => {
    const { data, error } = await supabase
      .from("markets")
      .select("*, amm_state:amm_state(*)")
      .eq("status", "open")
      .order("trade_count", { ascending: false });
    if (error) {
      console.error("Failed to refetch branch markets:", error.message);
      return;
    }
    if (data) setMarkets(data as unknown as MarketWithAmm[]);
  }, [supabase]);

  useEffect(() => {
    refetchRef.current = refetchMarkets;
  }, [refetchRef, refetchMarkets]);

  // Sort: ranked first, then by trade_count
  const ranked = markets
    .filter((m) => m.homepage_rank != null)
    .sort((a, b) => (a.homepage_rank ?? 0) - (b.homepage_rank ?? 0));
  const unranked = markets.filter((m) => m.homepage_rank == null);
  const sorted = ranked.length > 0 ? [...ranked, ...unranked] : markets;

  const heroMarket = sorted[0];
  const remainingMarkets = sorted.slice(1);

  return (
    <>
      {markets.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-custom text-sm">{t("noActiveMarkets")}</p>
        </div>
      )}

      {heroMarket && (
        <section className="mb-12">
          <HeroMarketCard
            market={heroMarket}
            onTradeClick={isDesktop ? undefined : (side) => openTrade(heroMarket, side)}
          />
        </section>
      )}

      {/* How It Works — mobile only (desktop has it in sidebar) */}
      <div className="xl:hidden mb-8">
        <HowItWorks />
      </div>

      {remainingMarkets.length > 0 && (
        <AllMarketsFeed markets={remainingMarkets} hrefPrefix={hrefPrefix} />
      )}

      {markets.length > 0 && <BottomSections />}
    </>
  );
}

export function BranchHomeClient({ initialMarkets, branchCode }: BranchHomeClientProps) {
  const refetchRef = useRef<(() => Promise<void>) | null>(null);

  const handleRefresh = async () => {
    window.location.reload();
  };

  return (
    <TradeSheetProvider refetchMarkets={async () => { await refetchRef.current?.(); }}>
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="pt-8 pb-12">
          <BranchHomeInner initialMarkets={initialMarkets} branchCode={branchCode} refetchRef={refetchRef} />
        </div>
      </PullToRefresh>
    </TradeSheetProvider>
  );
}
