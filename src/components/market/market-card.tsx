"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { MarketWithAmm } from "@/types/market";
import type { Side } from "@/types/database";
import { cn, formatCountdown, triggerHaptic } from "@/lib/utils";
import { formatSharePrice, getMarketTimeState } from "@/lib/market-utils";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { CSSProbabilityGauge } from "./css-probability-gauge";
import { MarketStatusBadge } from "./market-status-badge";

/** Category → gradient fallback when no image_url */
const CATEGORY_GRADIENTS: Record<string, string> = {
  politics: "from-yes/20 to-surface",
  economy: "from-success/20 to-surface",
  economics: "from-success/20 to-surface",
  sports: "from-warning/20 to-surface",
  tech: "from-[#A855F7]/20 to-surface",
  finance: "from-success/20 to-surface",
  entertainment: "from-[#EC4899]/20 to-surface",
  general: "from-muted-custom/20 to-surface",
};


interface MarketCardProps {
  market: MarketWithAmm;
  index?: number;
  onTradeClick?: (side: Side) => void;
  /** URL prefix for market links. Default: "/market" */
  hrefPrefix?: string;
}

export function MarketCard({ market, index = 0, onTradeClick, hrefPrefix = "/market" }: MarketCardProps) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations();
  const question = locale === "ar" ? market.question_ar : market.question_en;

  const yesPrice = market.amm_state?.current_yes_price ?? 0.5;
  const noPrice = market.amm_state?.current_no_price ?? 0.5;
  const yesPct = parseFloat((yesPrice * 100).toFixed(1));

  const timeState = getMarketTimeState(market);
  const isUpcoming = timeState === "upcoming";
  const isOpen = !isUpcoming && (timeState === "open" || timeState === "closing_soon");
  const catKey = (market.category || "general").toLowerCase();
  const gradientClass = CATEGORY_GRADIENTS[catKey] || CATEGORY_GRADIENTS.general;

  const resolvedIndicator = !isOpen ? (
    <div className="px-4 pt-3 pb-4">
      <div className={cn(
        "flex items-center justify-center gap-2 py-3 rounded-lg bg-surface border font-satoshi font-bold text-base",
        isUpcoming ? "border-warning/40 text-warning" : "border-border-custom text-muted-custom",
      )}>
        {isUpcoming ? (
          <>
            <Clock className="w-4 h-4" />
            <span>
              {t("market.opensIn")}{" "}
              <span className="tabular-nums">{formatCountdown(market.opens_at)}</span>
            </span>
          </>
        ) : market.status === "resolved" ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span>{market.outcome === "yes" ? t("market.resolvedYes") : t("market.resolvedNo")}</span>
          </>
        ) : market.status === "voided" ? (
          <>
            <XCircle className="w-4 h-4 text-error" />
            <span>{t("market.voided")}</span>
          </>
        ) : (
          <>
            <Clock className="w-4 h-4" />
            <span>{t("market.marketClosed")}</span>
          </>
        )}
      </div>
    </div>
  ) : null;

  // Shared card body (image + question + footer)
  const cardBody = (
    <>
      {/* Hero Image Area */}
      <div className="relative h-48 overflow-hidden">
        {market.image_url ? (
          <Image
            src={market.image_url}
            alt=""
            fill
            className="object-cover opacity-60 group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className={cn("w-full h-full bg-gradient-to-br", gradientClass)} />
        )}

        {/* Gradient overlay from surface color */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent" />

        {/* Status badge — top-right overlay */}
        <div className="absolute top-3 right-3 z-10">
          <MarketStatusBadge market={market} className="bg-surface/90 backdrop-blur-sm" />
        </div>

        {/* Overlaid Question + Gauge */}
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
          <h3 className="flex-1 text-xl font-medium font-satoshi leading-snug text-text drop-shadow-sm">
            {question}
          </h3>
          {!isUpcoming && <CSSProbabilityGauge percent={yesPct} />}
        </div>
      </div>
    </>
  );

  // When onTradeClick is provided: card body navigates, buttons trade
  // Buttons are OUTSIDE the Link so touch/active states work properly
  if (onTradeClick) {
    return (
      <div
        className={cn(
          "group bg-surface rounded-xl overflow-hidden",
          "hover:bg-elevated transition-all duration-200 cursor-pointer",
          "animate-in fade-in slide-in-from-bottom-2"
        )}
        style={{ animationDelay: `${index * 50}ms` }}
      >
        {/* Tappable area → navigates to market detail */}
        <div onClick={() => router.push(`${hrefPrefix}/${market.id}`)}>
          {cardBody}
        </div>

        {/* YES / NO Buttons — outside Link for proper 3D active state */}
        {isOpen ? (
          <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-4">
            <button
              onClick={() => { triggerHaptic(); onTradeClick("yes"); }}
              className="flex items-center justify-center py-3 rounded-lg bg-yes text-white text-base font-satoshi font-black
                shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]
                transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
            >
              {t("common.yes")} {formatSharePrice(yesPrice)}
            </button>
            <button
              onClick={() => { triggerHaptic(); onTradeClick("no"); }}
              className="flex items-center justify-center py-3 rounded-lg bg-no text-white text-base font-satoshi font-black
                shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]
                transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
            >
              {t("common.no")} {formatSharePrice(noPrice)}
            </button>
          </div>
        ) : resolvedIndicator}
      </div>
    );
  }

  // Fallback: card navigates via onClick
  return (
    <div
      className={cn(
        "group bg-surface rounded-xl overflow-hidden",
        "hover:bg-elevated transition-all duration-200 cursor-pointer",
        "animate-in fade-in slide-in-from-bottom-2"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      role="link"
      aria-label={isUpcoming ? question : `${question} — ${formatSharePrice(yesPrice)} ${t("market.chance")}`}
    >
      {/* Tappable area → navigates to market detail */}
      <div onClick={() => router.push(`${hrefPrefix}/${market.id}`)}>
        {cardBody}
      </div>

      {/* YES / NO Buttons → navigate to market detail */}
      {isOpen ? (
        <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-3">
          <Link
            href={`${hrefPrefix}/${market.id}`}
            onTouchStart={() => {}}
            className="flex items-center justify-center py-3 rounded-lg bg-yes text-white text-base font-satoshi font-black
            shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]
            transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
          >
            {t("common.yes")} {formatSharePrice(yesPrice)}
          </Link>
          <Link
            href={`${hrefPrefix}/${market.id}`}
            onTouchStart={() => {}}
            className="flex items-center justify-center py-3 rounded-lg bg-no text-white text-base font-satoshi font-black
            shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]
            transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
          >
            {t("common.no")} {formatSharePrice(noPrice)}
          </Link>
        </div>
      ) : resolvedIndicator}

    </div>
  );
}
