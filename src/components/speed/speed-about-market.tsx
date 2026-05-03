"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SpeedAsset, SpeedDuration } from "@/types/database";

const ASSET_LABELS: Record<SpeedAsset, string> = { BTC: "Bitcoin" };

const DURATION_LABELS: Record<SpeedDuration, string> = {
  "5m": "5-minute",
  "1h": "1-hour",
};

/**
 * Bottom section of /speed/[id]: an "About this Market" expandable card
 * mirroring the regular prediction-market AboutMarket pattern, with copy
 * tailored to the speed-trading mechanics (strike, TWAP, oracle).
 */
export function SpeedAboutMarket({
  asset,
  duration,
}: {
  asset: SpeedAsset;
  duration: SpeedDuration;
}) {
  const t = useTranslations("market");
  const [expanded, setExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  const assetLabel = ASSET_LABELS[asset];
  const durationLabel = DURATION_LABELS[duration];

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [asset, duration]);

  return (
    <div className="bg-surface rounded-lg border border-border-custom/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex justify-between items-center p-5 hover:bg-elevated transition-colors cursor-pointer rounded-lg"
      >
        <span className="font-satoshi font-medium text-lg text-text">
          {t("aboutThisMarket")}
        </span>
        <ChevronUp
          className={cn(
            "w-5 h-5 text-muted-custom transition-transform duration-300 ease-in-out",
            !expanded && "rotate-180",
          )}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: expanded ? contentHeight ?? 800 : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="px-5 pb-5 space-y-4">
          <p className="text-muted-custom text-base leading-relaxed font-dm-sans">
            This is a {durationLabel} {assetLabel} price prediction market. The
            target price is set at the moment the window opens from the live
            spot oracle. Bet <span className="font-bold text-text">Up</span> if
            you think {assetLabel} will be higher than the target at close, or{" "}
            <span className="font-bold text-text">Down</span> if you think it
            will be lower.
          </p>
          <p className="text-muted-custom text-base leading-relaxed font-dm-sans">
            Resolution reads the Binance BTC/USDT close price at exactly the
            market close time.{" "}
            <span className="font-bold text-text">Up</span> wins if the close
            is above target. <span className="font-bold text-text">Down</span>{" "}
            wins if below. If the close lands exactly at target, both sides
            lose.
          </p>
          <div className="pt-4 border-t border-border-custom flex items-center gap-3">
            <Info className="w-4 h-4 text-yes shrink-0" />
            <span className="text-xs text-muted-custom">
              Prices sourced from Binance BTC/USDT spot feed. Resolved
              automatically — no manual intervention.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
