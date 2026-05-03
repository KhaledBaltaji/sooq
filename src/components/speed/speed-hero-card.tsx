"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { cn } from "@/lib/utils";
import type { SpeedDuration, SpeedMarket } from "@/types/database";
import { useSpeed24hSparkline } from "@/hooks/use-speed-24h-sparkline";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { OdometerNumber } from "./odometer-number";

/**
 * Carousel placeholder while the BTC speed market is still being fetched.
 * Shape and dimensions match the real card so slot 0 doesn't shift when
 * data arrives (Phase 9i — prevents the initial Lebanese-Lira flash on
 * cold load before speedMarket resolves).
 */
export function SpeedHeroCardSkeleton() {
  return (
    <div className="block w-full bg-surface rounded-2xl overflow-hidden border border-border-custom shadow-2xl">
      <div className="p-6 flex flex-col justify-between min-h-[560px]">
        <div className="space-y-3 animate-pulse">
          {/* Badge row */}
          <div className="flex items-center gap-3">
            <div className="h-5 w-14 rounded bg-elevated" />
            <div className="h-5 w-12 rounded bg-elevated" />
            <div className="h-5 w-20 rounded bg-elevated" />
          </div>
          {/* Title */}
          <div className="h-8 w-3/4 rounded bg-elevated" />
          {/* Live price row — matches OdometerNumber slot in real card so
              the layout doesn't shift when the skeleton swaps to data. */}
          <div className="h-7 w-32 rounded bg-elevated" />
        </div>
        <div className="my-6 h-[160px] w-full rounded-lg bg-elevated/40 animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[80px] rounded-lg bg-elevated animate-pulse" />
          <div className="h-[80px] rounded-lg bg-elevated animate-pulse" />
        </div>
      </div>
    </div>
  );
}

const ASSET_LABELS: Record<string, string> = { BTC: "Bitcoin" };
const DURATION_LABELS: Record<SpeedDuration, string> = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "24h": "24 hours",
};

// Stylized fallback wave so the chart slot never renders empty when the
// 24h data isn't loaded yet. Matches the smooth-area look of the
// prediction-market `PriceChart` so both featured slides share visual
// rhythm.
const PLACEHOLDER_POINTS: number[] = [
  100, 102, 99, 104, 108, 106, 110, 113, 109, 107, 111, 115, 119, 116, 112,
  114, 117, 121, 118, 115, 120, 123, 119, 117, 121, 125, 128, 124, 122, 126,
];

/**
 * Carousel-sized speed market card. Visual size + structure mirrors
 * `HeroMarketCard` so the SPEED slot in `FeaturedMarketsCarousel` reads as
 * "same shelf, different product" rather than a tiny pill stuck next to
 * full-size prediction cards. Chart uses recharts `AreaChart` with the
 * same smooth-curve + gradient-fill treatment as `PriceChart`.
 *
 * Static-only: no oracle subscription, no countdown. The chart shows a
 * 24h BTC sparkline via the shared `useSpeed24hSparkline` hook. When the
 * data isn't loaded yet, a stylized placeholder wave fills the slot so
 * the middle of the card is never blank or boxy.
 */
export function SpeedHeroCard({ market }: { market: SpeedMarket }) {
  const t = useTranslations("speed");
  const { points } = useSpeed24hSparkline(market.asset);
  const { price: livePrice, isStale } = useSpeedOracleLatest(market.asset);

  // Cache the most-recently-seen price so a transient null doesn't flash
  // the price row to empty. `useSpeedOracleLatest` already preserves
  // `oracle` across loading flickers, but a hard null on first mount is
  // possible — keep a local fallback as belt-and-suspenders.
  const [lastShown, setLastShown] = useState<number | null>(null);
  useEffect(() => {
    if (livePrice !== null) setLastShown(livePrice);
  }, [livePrice]);
  const displayPrice = livePrice ?? lastShown;

  const assetLabel = ASSET_LABELS[market.asset] ?? market.asset;
  const durationLabel = DURATION_LABELS[market.duration];

  // Always render a chart visual. Prefer real 24h data; fall back to a
  // stylized placeholder when the cache is empty.
  const hasReal = points.length >= 2;
  const renderPoints = hasReal ? points : PLACEHOLDER_POINTS;
  const trendUp = renderPoints[renderPoints.length - 1] >= renderPoints[0];
  // Real-data colors stay vivid (green / red); placeholder is muted gray
  // so it doesn't imply a real direction signal.
  const lineColor = !hasReal
    ? "rgb(148, 163, 184)"
    : trendUp
      ? "rgb(20, 168, 100)"
      : "rgb(239, 68, 68)";

  // Shape data for recharts.
  const data = renderPoints.map((value, idx) => ({ idx, value }));
  const gradId = `speed-hero-area-${market.asset}-${hasReal ? "real" : "ph"}`;

  // On desktop the parallel-route intercept matches `/speed/[id]` and
  // returns null (Phase 9h) but the intercept still fires, freezing the
  // children slot on home. Force a full navigation on desktop so the
  // standalone /speed/[id] page actually renders.
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      e.preventDefault();
      window.location.href = `/speed/${market.id}`;
    }
  };

  return (
    <Link
      href={`/speed/${market.id}`}
      onClick={handleClick}
      className="block w-full bg-surface rounded-2xl overflow-hidden flex flex-col lg:flex-row border border-border-custom shadow-2xl lg:min-h-[520px] lg:max-h-[520px]"
    >
      {/* Left column — title + chart + UP/DOWN. Mirrors HeroMarketCard. */}
      <div className="lg:w-[50%] p-6 lg:p-8 flex flex-col justify-between lg:border-r border-border-custom min-h-[560px] lg:min-h-[520px]">
        <div>
          {/* Badge row */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <span className="bg-warning/10 text-warning text-[10px] font-black px-2 py-1 rounded tracking-widest uppercase border border-warning/30 font-satoshi">
              Speed
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-success/10 border border-success/30 text-success text-[10px] font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {t("live")}
            </span>
            <div className="flex items-center gap-1.5 text-muted-custom text-xs font-medium">
              <Calendar className="w-3.5 h-3.5" />
              <span>{durationLabel}</span>
            </div>
          </div>

          {/* Title */}
          <h1 className="font-satoshi text-xl lg:text-3xl xl:text-4xl font-bold leading-tight mb-2 text-text">
            {assetLabel}{" "}
            <span className="text-muted-custom font-medium">
              {t("upOrDown")}
            </span>
          </h1>

          {/* Live BTC oracle price below the title. Tweens via OdometerNumber
              on every tick. Falls back to last-known if the realtime stream
              briefly drops. Shown only once we have ANY price (live or
              cached), so first paint doesn't flash an empty row. */}
          {displayPrice !== null && (
            <div className="flex items-baseline gap-2 mb-6 lg:mb-8">
              <OdometerNumber
                value={displayPrice}
                prefix="$"
                className={cn(
                  "font-satoshi font-black tabular-nums text-2xl lg:text-3xl",
                  isStale ? "text-muted-custom" : "text-text",
                )}
              />
              {isStale && (
                <span className="text-[10px] text-muted-custom uppercase tracking-wider font-bold">
                  delayed
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mobile-only chart — recharts AreaChart, smooth curve + gradient,
            same visual language as the prediction-market PriceChart. */}
        <div className="lg:hidden my-6 h-[160px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* UP / DOWN — match Buy Yes / Buy No visual weight. */}
        <div className="space-y-6 mt-auto lg:mt-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-success text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] shadow-[0_4px_0_0px_rgba(20,90,60,0.9)]">
              <span className="text-white text-2xl lg:text-xl font-black uppercase tracking-wide">
                Up
              </span>
            </div>
            <div className="flex flex-col items-center justify-center h-[80px] lg:h-auto bg-destructive text-white rounded-lg font-satoshi font-bold lg:py-5 transition-all duration-[80ms] shadow-[0_4px_0_0px_rgba(140,15,30,0.9)]">
              <span className="text-white text-2xl lg:text-xl font-black uppercase tracking-wide">
                Down
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop right column — bigger version of the same chart. */}
      <div className="hidden lg:flex lg:w-[50%] bg-surface p-6 lg:p-8 flex-col grid-dots">
        <div className="mb-6">
          <p className="text-[10px] text-muted-custom uppercase font-medium tracking-widest mb-1">
            Instrument price
          </p>
          <div className="font-satoshi font-bold text-2xl text-text">
            {market.asset}/USD
          </div>
        </div>
        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`${gradId}-lg`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#${gradId}-lg)`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Link>
  );
}
