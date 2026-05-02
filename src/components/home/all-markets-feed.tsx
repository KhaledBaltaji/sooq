"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import type { MarketWithAmm } from "@/types/market";
import type { SpeedMarket } from "@/types/database";
import { MarketCard } from "@/components/market/market-card";
import { SpeedMarketCard } from "@/components/speed/speed-market-card";
import { useTradeSheet } from "@/components/trade/trade-sheet-provider";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { fadeUp, springs, stagger } from "@/lib/motion";

interface AllMarketsFeedProps {
  markets: MarketWithAmm[];
  /** Optional open speed markets — rendered at the leading positions of the grid. */
  speedMarkets?: SpeedMarket[];
  /** URL prefix for market links. Default: "/market" */
  hrefPrefix?: string;
}

export function AllMarketsFeed({ markets, speedMarkets = [], hrefPrefix }: AllMarketsFeedProps) {
  const t = useTranslations("market");
  const { openTrade } = useTradeSheet();
  const isDesktop = useIsDesktop();

  if (markets.length === 0 && speedMarkets.length === 0) return null;

  return (
    <section className="mb-16">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="font-satoshi text-2xl font-black mb-1">{t("allMarkets")}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {speedMarkets.map((sm, i) => (
          <motion.div
            key={`speed-${sm.id}`}
            initial={fadeUp.initial}
            animate={fadeUp.animate}
            transition={{ ...springs.smooth, ...stagger(i) }}
          >
            <SpeedMarketCard market={sm} index={i} />
          </motion.div>
        ))}
        {markets.map((market, i) => {
          const idx = speedMarkets.length + i;
          return (
            <motion.div
              key={market.id}
              initial={fadeUp.initial}
              animate={fadeUp.animate}
              transition={{ ...springs.smooth, ...stagger(idx) }}
            >
              <MarketCard
                market={market}
                index={idx}
                hrefPrefix={hrefPrefix}
                onTradeClick={isDesktop ? undefined : (side) => openTrade(market, side)}
              />
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
