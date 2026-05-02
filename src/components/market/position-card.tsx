"use client";

import type { Position, AmmState } from "@/types/market";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { sharesToLots, formatSharePrice, formatPrice } from "@/lib/market-utils";
import { MIN_DISPLAY_SHARES } from "@/lib/constants";
import { useTranslations } from "next-intl";

interface PositionCardProps {
  position: Position;
  ammState: AmmState;
  onClosePosition: (side: string, shares: number) => void;
}

export function PositionCard({ position, ammState, onClosePosition }: PositionCardProps) {
  const t = useTranslations("market");
  if (position.shares_held < MIN_DISPLAY_SHARES) return null;

  const currentPrice = position.side === "yes"
    ? ammState.current_yes_price
    : ammState.current_no_price;

  const currentValue = position.shares_held * currentPrice;

  return (
    <div className="bg-surface border border-border rounded-lg p-md space-y-sm">
      <div className="flex items-center justify-between">
        <span className={cn(
          "font-dm-sans font-semibold text-sm px-sm py-xs rounded",
          position.side === "yes" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"
        )}>
          {t("positionTitle", { side: position.side.toUpperCase() })}
        </span>
        <span className="text-sm font-medium text-text tabular-nums">
          {formatCurrency(currentValue)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-sm text-center">
        <div>
          <p className="text-xs text-muted">{t("lots", { defaultValue: "Lots" })}</p>
          <p className="text-sm font-medium text-text tabular-nums">{sharesToLots(position.shares_held).toFixed(3)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("avgPrice")}</p>
          <p className="text-sm font-medium text-text tabular-nums">{formatPrice(position.avg_entry_price, "neutral")}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("current")}</p>
          <p className="text-sm font-medium text-text tabular-nums">{formatPrice(currentPrice, "sell")}</p>
        </div>
      </div>

      <Button
        onClick={() => onClosePosition(position.side, position.shares_held)}
        className="w-full h-12 font-dm-sans font-semibold bg-elevated hover:bg-elevated/80 text-white"
      >
        {t("closePositionBtn")} — {formatCurrency(currentValue)}
      </Button>
    </div>
  );
}
