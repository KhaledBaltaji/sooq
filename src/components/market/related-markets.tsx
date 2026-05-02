"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSupabase } from "@/components/providers/supabase-provider";
import Link from "next/link";
import dynamic from "next/dynamic";

const PriceChart = dynamic(() => import("@/components/market/price-chart").then(m => ({ default: m.PriceChart })), {
  ssr: false,
  loading: () => <div className="animate-shimmer h-16 rounded-lg" />,
});
import { cn } from "@/lib/utils";

interface RelatedMarketsProps {
  currentMarketId: string;
  category: string;
  className?: string;
}

interface RelatedMarket {
  id: string;
  question_en: string;
  question_ar: string | null;
  current_yes_price: number;
  amm_state: any | null;
}

export function RelatedMarkets({ currentMarketId, category, className }: RelatedMarketsProps) {
  const supabase = useSupabase();
  const locale = useLocale();
  const t = useTranslations("market");
  const [markets, setMarkets] = useState<RelatedMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRelated() {
      // Exclude upcoming markets — we don't show odds for markets that haven't opened.
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("markets")
        .select("id, question_en, question_ar, amm_state(*)")
        .eq("category", category)
        .neq("id", currentMarketId)
        .eq("status", "open")
        .lte("opens_at", nowIso)
        .limit(3);

      if (data) {
        setMarkets(
          data.map((m: any) => {
            const amm = Array.isArray(m.amm_state) ? m.amm_state[0] : m.amm_state;
            return {
              id: m.id,
              question_en: m.question_en,
              question_ar: m.question_ar ?? null,
              current_yes_price: amm?.current_yes_price ?? 0.5,
              amm_state: amm ?? null,
            };
          })
        );
      }
      setLoading(false);
    }

    fetchRelated();
  }, [supabase, currentMarketId, category]);

  if (loading || markets.length === 0) return null;

  return (
    <div className={cn("space-y-4", className)}>
      <h3 className="font-satoshi font-medium text-sm text-muted-custom uppercase tracking-widest px-1">
        {t("relatedMarkets")}
      </h3>
      <div className="space-y-3">
        {markets.map((m) => {
          const pct = m.current_yes_price * 100;
          const isHigh = pct >= 50;

          return (
            <Link
              key={m.id}
              href={`/market/${m.id}`}
              className="block bg-surface p-4 rounded-lg border border-border-custom/50 hover:border-yes/30 transition-all cursor-pointer group"
            >
              <h4 className="text-sm font-medium mb-3 line-clamp-2 leading-snug group-hover:text-yes transition-colors text-text">
                {locale === "ar" && m.question_ar ? m.question_ar : m.question_en}
              </h4>
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-custom uppercase font-medium tracking-wider">
                    {t("probability")}
                  </span>
                  <span className={cn(
                    "text-lg font-black font-satoshi",
                    isHigh ? "text-yes" : "text-no"
                  )}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="w-16 h-8">
                  <PriceChart marketId={m.id} compact className="!h-8" ammState={m.amm_state} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
