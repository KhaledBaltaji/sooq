"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Market, MarketTimeState } from "@/types/market";
import { getMarketTimeState } from "@/lib/market-utils";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<MarketTimeState, string> = {
  upcoming: "border-warning/40 text-warning bg-warning/10",
  open: "border-success/40 text-success bg-success/10",
  closing_soon: "border-warning/40 text-warning bg-warning/10",
  closed: "border-border-custom text-muted-custom bg-elevated",
  resolved: "border-yes/40 text-yes bg-yes/10",
  voided: "border-error/40 text-error bg-error/10",
};

const STATE_KEYS: Record<MarketTimeState, string> = {
  upcoming: "statusUpcoming",
  open: "statusLive",
  closing_soon: "statusClosingSoon",
  closed: "statusEnded",
  resolved: "statusResolved",
  voided: "statusVoided",
};

export function MarketStatusBadge({ market, className }: { market: Market; className?: string }) {
  const t = useTranslations("market");
  const state = getMarketTimeState(market);
  const isLive = state === "open";

  return (
    <Badge variant="outline" className={cn("text-xs gap-1.5 font-medium", STATE_STYLES[state], className)}>
      {isLive && (
        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
      )}
      {t(STATE_KEYS[state])}
    </Badge>
  );
}
