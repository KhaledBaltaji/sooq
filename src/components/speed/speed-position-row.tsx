"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Zap, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  durationToSeconds,
  formatSpeedCountdown,
  isUrgent,
  speedFairProbOver,
} from "@/lib/speed/pricing";
import type { SpeedPositionWithMarket } from "@/hooks/use-speed-positions";

const IV: Record<string, number> = { BTC: 0.6 };

export function SpeedPositionRow({
  pos,
  livePrice,
  isStale,
}: {
  pos: SpeedPositionWithMarket;
  livePrice: number | null;
  isStale: boolean;
}) {
  const t = useTranslations("speed");
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const market = pos.market;
  if (!market) return null;

  const totalSeconds = durationToSeconds(market.duration);
  const closesAt = new Date(market.closes_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const urgent = isUrgent(totalSeconds, secondsLeft);

  const stake = Number(pos.stake);
  const entryOfferedProb = Number(pos.entry_offered_prob);
  const payoutPerDollar = 1 / entryOfferedProb;
  const potentialPayout = stake * payoutPerDollar;
  const strike = Number(market.strike_price);

  const fairOver =
    livePrice && !isStale && pos.status === "open" && market.status === "open"
      ? speedFairProbOver(livePrice, strike, secondsLeft, IV[market.asset] ?? 0.6)
      : null;
  const fairForSide = fairOver !== null
    ? pos.side === "over" ? fairOver : 1 - fairOver
    : null;
  const fairValue = fairForSide !== null
    ? fairForSide * stake * payoutPerDollar
    : null;
  const pnl = fairValue !== null ? fairValue - stake : null;

  const sideColor = pos.side === "over" ? "text-success" : "text-destructive";
  const sideBg = pos.side === "over" ? "bg-success/10" : "bg-destructive/10";

  const statusLabel = (() => {
    if (pos.status === "open") return null;
    if (pos.status === "won") return { label: t("won"), color: "text-success" };
    if (pos.status === "lost") return { label: t("lost"), color: "text-destructive" };
    if (pos.status === "cashed_out") return { label: t("cashOut"), color: "text-text" };
    if (pos.status === "refunded") return { label: t("voided"), color: "text-warning" };
    return null;
  })();

  return (
    <Link
      href={`/speed/${market.id}`}
      className="block rounded-2xl border border-border-custom bg-surface p-4 transition hover:border-text/40 active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            <Zap className="h-3 w-3" strokeWidth={2.5} />
            {t("badge")}
          </Badge>
          <span className="text-sm font-bold">
            {market.asset} {market.duration}
          </span>
        </div>
        {pos.status === "open" && (market.status === "resolving" || (secondsLeft <= 0 && market.status === "open")) ? (
          <span className="text-xs font-bold uppercase tracking-wide text-muted-custom animate-pulse">
            {t("resolving")}
          </span>
        ) : pos.status === "open" && market.status === "open" ? (
          <span
            className={cn(
              "font-satoshi text-sm font-bold tabular-nums",
              urgent ? "animate-pulse text-destructive" : "text-muted-custom",
            )}
          >
            {formatSpeedCountdown(secondsLeft)}
          </span>
        ) : statusLabel ? (
          <span className={cn("text-xs font-bold uppercase tracking-wide", statusLabel.color)}>
            {statusLabel.label}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className={cn("rounded-lg p-2", sideBg)}>
          <div className={cn("text-[10px] font-bold uppercase tracking-wide", sideColor)}>
            {pos.side === "over" ? t("up") : t("down")}
          </div>
          <div className={cn("font-satoshi text-base font-bold tabular-nums", sideColor)}>
            {Math.round(entryOfferedProb * 100)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-custom">
            {t("stake")}
          </div>
          <div className="font-satoshi text-base font-bold tabular-nums">
            ${stake.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
          {pos.status === "open" && fairValue !== null ? (
            <>
              <div className="text-[10px] uppercase tracking-wide text-muted-custom">
                {t("currentValue")}
              </div>
              <div
                className={cn(
                  "font-satoshi text-base font-bold tabular-nums",
                  pnl !== null && pnl >= 0 ? "text-success" : "text-destructive",
                )}
              >
                ${fairValue.toFixed(2)}
              </div>
            </>
          ) : pos.payout_amount !== null && pos.payout_amount !== undefined ? (
            <>
              <div className="text-[10px] uppercase tracking-wide text-muted-custom">
                {t("potentialPayout")}
              </div>
              <div className="font-satoshi text-base font-bold tabular-nums">
                ${Number(pos.payout_amount).toFixed(2)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wide text-muted-custom">
                {t("potentialPayout")}
              </div>
              <div className="font-satoshi text-base font-bold tabular-nums text-muted-custom">
                ${potentialPayout.toFixed(2)}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end text-[11px] text-muted-custom">
        <span>Strike ${strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <ChevronRight className="ml-1 h-3 w-3" />
      </div>
    </Link>
  );
}
