"use client";

import type { AmmState } from "@/types/market";
import { Odometer } from "@/components/ui/odometer";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useTranslations } from "next-intl";

interface PriceDisplayProps {
  ammState: AmmState | null;
  size?: "sm" | "lg";
  mode?: "default" | "hero";
  className?: string;
}

export function PriceDisplay({ ammState, size = "lg", mode = "default", className }: PriceDisplayProps) {
  const t = useTranslations("market");
  if (!ammState) {
    return (
      <div className={cn(mode === "hero" ? "space-y-2" : "flex items-center gap-lg justify-center", className)}>
        <Skeleton className={mode === "hero" ? "h-16 w-48" : "h-12 w-32"} />
      </div>
    );
  }

  // Hero mode — big "62% chance" display
  if (mode === "hero") {
    const yesPct = ammState.current_yes_price * 100;
    // Simple daily change heuristic: delta from neutral 50%
    const dailyChange = parseFloat((yesPct - 50).toFixed(1));
    const isPositive = dailyChange >= 0;

    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-baseline gap-3">
          <span className="font-satoshi font-black text-5xl md:text-6xl tabular-nums text-yes">
            {yesPct.toFixed(1)}%
          </span>
          <span className="text-lg font-medium text-muted/80">{t("chance")}</span>
        </div>
        {dailyChange !== 0 && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-bold",
              isPositive ? "bg-success/10 text-success" : "bg-no/10 text-no"
            )}>
              {isPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {isPositive ? "+" : ""}{dailyChange.toFixed(1)}%
              <span className="text-xs font-medium opacity-60 ms-0.5">{t("todayChange")}</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // Default mode — YES 62% / NO 38%
  const textSize = size === "lg" ? "text-2xl" : "text-lg";
  const yesPct = ammState.current_yes_price * 100;
  const noPct = 100 - yesPct;

  return (
    <div className={cn("flex items-center justify-center gap-lg", className)}>
      <div className="flex items-baseline gap-xs">
        <span className={cn("font-satoshi font-black tabular-nums text-yes", textSize)}>
          <Odometer value={yesPct} format={(n: number) => `${n.toFixed(1)}%`} />
        </span>
        <span className="text-xs text-muted font-dm-sans">{t("yesLabel")}</span>
      </div>
      <span className="text-muted text-sm">/</span>
      <div className="flex items-baseline gap-xs">
        <span className={cn("font-satoshi font-black tabular-nums text-no", textSize)}>
          <Odometer value={noPct} format={(n: number) => `${n.toFixed(1)}%`} />
        </span>
        <span className="text-xs text-muted font-dm-sans">{t("noLabel")}</span>
      </div>
    </div>
  );
}
