"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import type { MarketWithAmm } from "@/types/market";
import { MarketIcon } from "@/components/market/market-icon";
import { getMarketTimeState } from "@/lib/market-utils";
import { fadeUp, springs, stagger } from "@/lib/motion";
import { formatCountdown } from "@/lib/utils";
import { Clock } from "lucide-react";

/** Semi-circle probability gauge */
function ProbabilityGauge({ percent, chanceLabel }: { percent: number; chanceLabel: string }) {
  const radius = 28;
  const strokeWidth = 5;
  const cx = 34;
  const cy = 34;
  const circumference = Math.PI * radius;
  const filled = (percent / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={68} height={40} viewBox="0 0 68 40" className="overflow-visible">
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="var(--yes)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-text text-[13px] font-black font-satoshi"
        >
          {percent.toFixed(1)}%
        </text>
      </svg>
      <span className="text-[8px] text-muted-custom -mt-1">{chanceLabel}</span>
    </div>
  );
}

interface LiveMarketsProps {
  markets: MarketWithAmm[];
}

export function LiveMarkets({ markets }: LiveMarketsProps) {
  const locale = useLocale();
  const t = useTranslations("home");

  if (markets.length === 0) return null;

  return (
    <section className="mb-16">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="font-satoshi text-2xl font-black mb-1">{t("liveMarkets")}</h2>
          <p className="text-sm text-muted-custom">{t("liveMarketsDesc")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {markets.slice(0, 2).map((market, i) => {
          const question = locale === "ar" ? market.question_ar : market.question_en;
          const yesPrice = market.amm_state?.current_yes_price ?? 0.5;
          const yesPct = parseFloat((yesPrice * 100).toFixed(1));
          const isUpcoming = getMarketTimeState(market) === "upcoming";
          const resolvesDate = new Date(market.closes_at).toLocaleDateString(locale === "ar" ? "ar" : "en-US", {
            month: "short",
            day: "numeric",
          });

          return (
            <motion.div
              key={market.id}
              initial={fadeUp.initial}
              animate={fadeUp.animate}
              transition={{ ...springs.smooth, ...stagger(i) }}
            >
            <Link
              href={`/market/${market.id}`}
              className="bg-surface p-6 rounded-xl border border-border-custom flex flex-col justify-between min-h-[220px] group transition-all duration-150 hover:-translate-y-1.5 hover:scale-[1.01] hover:shadow-[0_4px_8px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.12),0_20px_48px_rgba(0,0,0,0.08)] hover:border-border-custom/60 active:translate-y-0 active:scale-100 active:shadow-none"
            >
              <div className="flex items-start gap-3">
                {/* Market Icon */}
                <MarketIcon category={market.category} size="sm" className="mt-0.5 flex-shrink-0" />

                <div className="flex-1 min-w-0 pe-2">
                  <span className="text-[10px] font-medium text-yes uppercase tracking-widest mb-2 block">
                    {market.category}
                  </span>
                  <h3 className="font-medium text-lg leading-snug font-satoshi">
                    {question}
                  </h3>
                </div>

                {/* Probability Gauge — hidden until the market opens */}
                <div className="flex-shrink-0">
                  {isUpcoming ? (
                    <div className="flex flex-col items-center text-warning">
                      <Clock className="w-5 h-5" />
                      <span className="text-[9px] font-bold uppercase tracking-widest mt-1 tabular-nums">
                        {formatCountdown(market.opens_at)}
                      </span>
                    </div>
                  ) : (
                    <ProbabilityGauge percent={yesPct} chanceLabel={t("chance")} />
                  )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border-custom/50 flex items-center justify-end gap-2">
                <span className="text-muted-custom text-[9px] uppercase font-medium tracking-tighter opacity-60">{t("resolves")}</span>
                <span className="text-text font-medium text-xs">{resolvesDate}</span>
              </div>
            </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
