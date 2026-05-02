"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { MarketWithAmm } from "@/types/market";
import dynamic from "next/dynamic";

const PriceChart = dynamic(() => import("./price-chart").then(m => ({ default: m.PriceChart })), {
  ssr: false,
  loading: () => <div className="animate-shimmer h-16 rounded-lg" />,
});
import { cn, formatCountdown, triggerHaptic } from "@/lib/utils";
import { formatSharePrice, getMarketTimeState } from "@/lib/market-utils";
import { Calendar, CheckCircle2, XCircle, Clock } from "lucide-react";
import { MarketStatusBadge } from "./market-status-badge";
import type { Side } from "@/types/database";

interface HeroMarketCardProps {
  market: MarketWithAmm;
  onTradeClick?: (side: Side) => void;
  /**
   * Passed to the mobile sparkline so the chart draws in on mount.
   * Used by the featured-markets carousel to animate only the active slide.
   */
  animateChart?: boolean;
  /**
   * When this value changes, the mobile sparkline remounts — used by the
   * featured-markets carousel to replay the draw-in animation each time a
   * slide becomes active (including re-entry).
   */
  animationKey?: number;
}

export function HeroMarketCard({ market, onTradeClick, animateChart = false, animationKey }: HeroMarketCardProps) {
  const locale = useLocale();
  const t = useTranslations("market");
  const tHero = useTranslations("hero");
  const question = locale === "ar" ? market.question_ar : market.question_en;

  const yesPrice = market.amm_state?.current_yes_price ?? 0.5;
  const noPrice = market.amm_state?.current_no_price ?? 0.5;

  const timeState = getMarketTimeState(market);
  const isUpcoming = timeState === "upcoming";
  const isOpen = !isUpcoming && (timeState === "open" || timeState === "closing_soon");
  const endsDate = new Date(market.closes_at).toLocaleDateString(locale === "ar" ? "ar" : "en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <section className="w-full bg-surface rounded-2xl overflow-hidden flex flex-col lg:flex-row border border-border-custom shadow-2xl lg:max-h-[520px]">
      {/* Left Content — min-h lives here so the column always fills the card.
          That keeps Buy Yes / Buy No anchored to the bottom regardless of how
          long or short the question is. */}
      <div className="lg:w-[50%] p-6 lg:p-8 flex flex-col justify-between lg:border-r border-border-custom min-h-[560px] lg:min-h-0">
        <div>
          {/* Badge + Status + Date */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <span className="bg-yes/10 text-yes text-[10px] font-black px-2 py-1 rounded tracking-widest uppercase border border-yes/30 font-satoshi">
              {tHero("primaryMarket")}
            </span>
            <MarketStatusBadge market={market} />
            <div className="flex items-center gap-1.5 text-muted-custom text-xs font-medium">
              <Calendar className="w-3.5 h-3.5" />
              <span>{tHero("ends", { date: endsDate })}</span>
            </div>
          </div>

          {/* Question — clamp to keep the card a consistent height across short / long questions on mobile */}
          <Link href={`/market/${market.id}`}>
            <h1 className="font-satoshi text-xl lg:text-3xl xl:text-4xl font-bold leading-tight mb-6 lg:mb-8 text-text hover:text-yes transition-colors line-clamp-3 lg:line-clamp-none">
              {question}
            </h1>
          </Link>
        </div>

        {/* Chart — mobile only */}
        {!isUpcoming && (
          <div className="lg:hidden my-6">
            <PriceChart
              marketId={market.id}
              compact
              className="h-[160px] w-full"
              ammState={market.amm_state}
              animate={animateChart}
              animationKey={animationKey}
              period="ALL"
            />
          </div>
        )}

        <div className="space-y-6 mt-auto lg:mt-0">
          {/* Buy Yes / Buy No — 3D press effect */}
          {isOpen ? (
            <div className="grid grid-cols-2 gap-3">
              {onTradeClick ? (
                <button
                  onClick={() => { triggerHaptic(); onTradeClick("yes"); }}
                  className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-yes text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] hover:brightness-110 shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)] [-webkit-tap-highlight-color:transparent]"
                >
                  <span className={`text-white/80 ${locale === "ar" ? "text-sm" : "text-[9px]"} lg:text-[10px] font-bold uppercase tracking-widest mb-0.5 lg:mb-1`}>{tHero("buyYes")}</span>
                  <span className="text-2xl lg:text-xl font-black tabular-nums">{formatSharePrice(yesPrice)}</span>
                </button>
              ) : (
                <Link
                  href={`/market/${market.id}`}
                  className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-yes text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] hover:brightness-110 shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]"
                >
                  <span className={`text-white/80 ${locale === "ar" ? "text-sm" : "text-[9px]"} lg:text-[10px] font-bold uppercase tracking-widest mb-0.5 lg:mb-1`}>{tHero("buyYes")}</span>
                  <span className="text-2xl lg:text-xl font-black tabular-nums">{formatSharePrice(yesPrice)}</span>
                </Link>
              )}
              {onTradeClick ? (
                <button
                  onClick={() => { triggerHaptic(); onTradeClick("no"); }}
                  className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-no text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] hover:brightness-110 shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)] [-webkit-tap-highlight-color:transparent]"
                >
                  <span className={`text-white/80 ${locale === "ar" ? "text-sm" : "text-[9px]"} lg:text-[10px] font-bold uppercase tracking-widest mb-0.5 lg:mb-1`}>{tHero("buyNo")}</span>
                  <span className="text-2xl lg:text-xl font-black tabular-nums">{formatSharePrice(noPrice)}</span>
                </button>
              ) : (
                <Link
                  href={`/market/${market.id}`}
                  className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-no text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] hover:brightness-110 shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]"
                >
                  <span className={`text-white/80 ${locale === "ar" ? "text-sm" : "text-[9px]"} lg:text-[10px] font-bold uppercase tracking-widest mb-0.5 lg:mb-1`}>{tHero("buyNo")}</span>
                  <span className="text-2xl lg:text-xl font-black tabular-nums">{formatSharePrice(noPrice)}</span>
                </Link>
              )}
            </div>
          ) : (
            <div className={cn(
              "flex items-center justify-center gap-2 h-[80px] lg:h-auto lg:py-5 rounded-lg bg-surface border font-satoshi font-bold text-lg",
              isUpcoming ? "border-warning/40 text-warning" : "border-border-custom text-muted-custom",
            )}>
              {isUpcoming ? (
                <>
                  <Clock className="w-5 h-5" />
                  <span>
                    {t("opensIn")}{" "}
                    <span className="tabular-nums">{formatCountdown(market.opens_at)}</span>
                  </span>
                </>
              ) : market.status === "resolved" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span>{market.outcome === "yes" ? t("resolvedYes") : t("resolvedNo")}</span>
                </>
              ) : market.status === "voided" ? (
                <>
                  <XCircle className="w-5 h-5 text-error" />
                  <span>{t("voided")}</span>
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5" />
                  <span>{t("marketClosed")}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Content — Chart with grid dots, desktop only */}
      <div className="hidden lg:flex lg:w-[50%] bg-surface p-6 lg:p-8 flex-col grid-dots">
        {isUpcoming ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <Clock className="w-10 h-10 text-warning mb-3" />
            <p className="text-[10px] text-muted-custom uppercase font-medium tracking-widest mb-1">{t("opensIn")}</p>
            <p className="text-3xl font-black font-satoshi text-warning tabular-nums">
              {formatCountdown(market.opens_at)}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] text-muted-custom uppercase font-medium tracking-widest mb-1">{tHero("instrumentPrice")}</p>
                <h2 className="text-3xl font-black font-satoshi text-yes tabular-nums">{formatSharePrice(yesPrice)}</h2>
              </div>
            </div>
            <PriceChart marketId={market.id} hideExtras className="flex-1" ammState={market.amm_state} />
          </>
        )}
      </div>
    </section>
  );
}
