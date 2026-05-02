"use client";

import { memo } from "react";
import Image from "next/image";
import { cn, formatCurrency } from "@/lib/utils";
import type { PositionWithMarket } from "@/types/market";

interface PositionCardProps {
  position: PositionWithMarket;
  locale: string;
  onTap: () => void;
}

function PositionCardImpl({ position, locale, onTap }: PositionCardProps) {
  const { market, amm_state: ammState } = position;
  const side = position.side as "yes" | "no";

  const currentPrice =
    side === "yes" ? ammState?.current_yes_price ?? 0 : ammState?.current_no_price ?? 0;
  const currentValue = position.shares_held * currentPrice;
  const costBasis = position.shares_held * position.avg_entry_price;
  const pnl = currentValue - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

  const question =
    locale === "ar"
      ? market?.question_ar || market?.question_en || "—"
      : market?.question_en || market?.question_ar || "—";
  const category = market?.category || "";

  const isNeutral = Math.abs(pnl) < 0.005;
  const up = !isNeutral && pnl > 0;
  const down = !isNeutral && pnl < 0;

  const pnlToneClass = isNeutral ? "text-muted-custom" : up ? "text-success" : "text-no";

  const fallbackLetter = (category || question).charAt(0).toUpperCase() || "?";

  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left rounded-2xl bg-surface border border-border-custom p-3.5 flex items-start gap-3 active:opacity-80 transition-opacity"
      aria-label={`Open position: ${question}`}
    >
      {market?.image_url ? (
        <Image
          src={market.image_url}
          alt=""
          width={44}
          height={44}
          className="w-11 h-11 rounded-xl object-cover shrink-0"
        />
      ) : (
        <div className="w-11 h-11 rounded-xl bg-surface border border-border-custom flex items-center justify-center shrink-0">
          <span className="font-satoshi font-black text-[18px] text-muted-custom leading-none">
            {fallbackLetter}
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="mb-1 font-satoshi font-bold text-[10px] uppercase tracking-[0.16em] text-muted-custom">
          {category}
        </div>
        <p
          className="font-satoshi font-medium text-[14px] leading-snug text-text"
          dir={locale === "ar" ? "rtl" : "ltr"}
        >
          {question}
        </p>
      </div>

      <div className="text-right shrink-0 min-w-[76px]">
        <div className={cn("font-satoshi font-black text-[18px] leading-none tabular-nums -tracking-tight", pnlToneClass)}>
          {up ? "+" : down ? "−" : ""}
          {formatCurrency(Math.abs(pnl))}
        </div>
        <div className={cn("font-satoshi font-bold text-[13px] tabular-nums mt-1", pnlToneClass)}>
          {up ? "+" : down ? "−" : ""}
          {Math.abs(pnlPct).toFixed(1)}%
        </div>
      </div>
    </button>
  );
}

export const PositionCard = memo(PositionCardImpl);
