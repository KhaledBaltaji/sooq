"use client";

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SpeedAssetIcon } from "./speed-asset-icon";
import { SpeedVolatilityBadge } from "./speed-volatility-badge";
import {
  durationToSeconds,
  formatSpeedCountdown,
  isUrgent,
} from "@/lib/speed/pricing";
import type { SpeedAsset, SpeedDuration, SpeedMarketStatus } from "@/types/database";

const ASSET_LABELS: Record<SpeedAsset, string> = { BTC: "Bitcoin" };

interface SpeedAssetHeaderProps {
  asset: SpeedAsset;
  duration: SpeedDuration;
  opensAt: string;
  closesAt: string;
  status?: SpeedMarketStatus | string;
  livePrice: number | null;
  strikePrice: number;
  twap?: number | null;
  isStale: boolean;
  shareSlot?: ReactNode;
}

/**
 * Two-row header for the speed market detail page, mirroring the
 * prediction market header pattern (src/app/(app)/market/[id]/page.tsx).
 *
 *  Row 1: asset icon + title (left)  •  countdown + share slot (right)
 *  Row 2: SPEED badge + status dot + time range + volatility + strike/live
 *
 * The countdown takes the visual slot of the prediction market's
 * probability number.
 */
export const SpeedAssetHeader = forwardRef<HTMLDivElement, SpeedAssetHeaderProps>(
  function SpeedAssetHeader(
    {
      asset,
      duration,
      opensAt,
      closesAt,
      status,
      livePrice,
      strikePrice,
      twap,
      isStale,
      shareSlot,
    },
    ref,
  ) {
    const t = useTranslations("speed");
    const totalSeconds = durationToSeconds(duration);
    const closesMs = new Date(closesAt).getTime();
    const [now, setNow] = useState<number>(Date.now());

    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(id);
    }, []);

    const secondsLeft = Math.max(0, Math.floor((closesMs - now) / 1000));
    const expired = secondsLeft <= 0;
    const urgent = isUrgent(totalSeconds, secondsLeft);
    const hideCountdown = expired || (status && status !== "open");

    const isResolved = status === "resolved";
    const isOpen = !expired && status === "open";
    const showLivePrice = !isResolved && livePrice !== null;
    const priceDelta =
      livePrice !== null ? livePrice - strikePrice : null;
    const isUp = priceDelta !== null && priceDelta > 0;
    const isDown = priceDelta !== null && priceDelta < 0;

    const statusLabel = isOpen
      ? t("live")
      : status === "resolved"
        ? t("resolved")
        : status === "voided"
          ? t("voided")
          : status === "halted"
            ? t("marketClosed")
            : expired
              ? t("settling")
              : t("live");
    const statusColor = isOpen
      ? "text-success"
      : status === "voided"
        ? "text-no"
        : "text-muted-custom";
    const statusDotColor = isOpen
      ? "bg-success"
      : status === "voided"
        ? "bg-no"
        : "bg-muted-custom";

    return (
      <div className="pt-3 pb-2">
        {/* Row 1: title + countdown */}
        <div ref={ref} className="flex items-baseline justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="hidden lg:block mt-0.5 shrink-0">
              <SpeedAssetIcon asset={asset} size="md" />
            </div>
            <h1 className="text-xl lg:text-2xl font-black font-satoshi tracking-tight leading-tight text-text">
              {ASSET_LABELS[asset]}{" "}
              <span className="font-medium text-muted-custom">
                {t("upOrDown")} {duration}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!hideCountdown && (
              <span
                className={cn(
                  "text-2xl lg:text-3xl font-black font-satoshi tabular-nums whitespace-nowrap leading-none",
                  urgent ? "text-destructive" : "text-text",
                )}
              >
                {formatSpeedCountdown(secondsLeft)}
              </span>
            )}
            {shareSlot}
          </div>
        </div>

        {/* Row 2: stats bar */}
        <div className="flex items-center gap-2 lg:gap-3 mt-1.5 text-[11px] text-muted-custom">
          <span className="hidden lg:inline px-2 py-0.5 rounded-md bg-white/10 border border-white/20 text-text font-bold tracking-wide uppercase shrink-0">
            Speed
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span className={cn("w-1.5 h-1.5 rounded-full", statusDotColor)} />
            <span className={cn("font-bold uppercase tracking-wider", statusColor)}>
              {statusLabel}
            </span>
          </div>
          <span className="tabular-nums shrink-0">
            {formatTimeRange(opensAt, closesAt)}
          </span>
          <SpeedVolatilityBadge asset={asset} />
          <span className="hidden sm:inline text-muted-custom/60 shrink-0">|</span>
          <span className="hidden sm:flex items-center gap-1 shrink-0 tabular-nums">
            <span className="text-muted-custom">Target</span>
            <span className="text-text font-bold">
              ${strikePrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </span>
          {isResolved && twap != null ? (
            <span className="hidden sm:flex items-center gap-1 shrink-0 tabular-nums">
              <span className="text-muted-custom/60">|</span>
              <span className="text-muted-custom">Close</span>
              <span className="text-text font-bold">
                ${twap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
          ) : showLivePrice ? (
            <span className="flex items-center gap-1 shrink-0 tabular-nums">
              <span className="hidden sm:inline text-muted-custom/60">|</span>
              <span className="text-muted-custom">Live</span>
              <span
                className={cn(
                  "font-bold",
                  isStale
                    ? "text-muted-custom"
                    : isUp
                      ? "text-success"
                      : isDown
                        ? "text-destructive"
                        : "text-text",
                )}
              >
                ${livePrice!.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);

function formatTimeRange(opens: string, closes: string): string {
  const o = new Date(opens);
  const c = new Date(closes);
  return `${formatTime(o)} – ${formatTime(c)}`;
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}
