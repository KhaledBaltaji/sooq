"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  durationToSeconds,
  formatSpeedCountdown,
  isUrgent,
  speedCashoutMultiplier,
  speedFairProbOver,
} from "@/lib/speed/pricing";
import type { SpeedMarket, SpeedPosition } from "@/types/database";
import { useSpeedCashout } from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";

export function SpeedPositionPanel({
  market,
  position,
  livePrice,
  isStale,
}: {
  market: SpeedMarket;
  position: SpeedPosition;
  livePrice: number | null;
  isStale: boolean;
}) {
  const t = useTranslations("speed");
  const { cashout, loading: cashLoading, error: cashError } = useSpeedCashout();
  const feeConfig = useSpeedFeeConfig();
  const { iv } = feeConfig;
  const totalSeconds = durationToSeconds(market.duration);
  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0;
  const urgent = isUrgent(totalSeconds, secondsLeft);

  const strike = Number(market.strike_price);
  const stake = Number(position.stake);
  const entryOfferedProb = Number(position.entry_offered_prob);
  const payoutPerDollar = 1 / entryOfferedProb;
  const potentialPayout = stake * payoutPerDollar;

  const fairOver = livePrice && !isStale
    ? speedFairProbOver(livePrice, strike, secondsLeft, iv[market.asset] ?? 0.6)
    : null;
  const fairForSide = fairOver !== null
    ? position.side === "over"
      ? fairOver
      : 1 - fairOver
    : null;
  const fairValue = fairForSide !== null ? fairForSide * stake * payoutPerDollar : null;
  const fairProfit = fairValue !== null ? fairValue - stake : null;
  const role: "winner" | "loser" | null = fairForSide !== null
    ? fairForSide >= entryOfferedProb
      ? "winner"
      : "loser"
    : null;

  // mig 351: continuous multiplier — linear interpolation between _low/_high
  // fee_config keys. Replaces the bucket lookup (high/mid/low) so the cashout
  // preview slides smoothly as time decays instead of snapping at 60%/20%.
  const pct = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
  const multiplier = role
    ? speedCashoutMultiplier(market.duration, role, pct, feeConfig)
    : null;

  let estCashout: number | null = null;
  if (multiplier !== null && fairValue !== null && fairProfit !== null && role) {
    estCashout = role === "winner"
      ? stake + fairProfit * multiplier
      : fairValue * multiplier;
    estCashout = Math.max(0, Math.round(estCashout * 100) / 100);
  }

  const sideColor = position.side === "over" ? "text-success" : "text-destructive";
  const sideBg = position.side === "over" ? "bg-success/10" : "bg-destructive/10";

  async function handleCashout() {
    if (cashLoading || expired) return;
    await cashout(position.id);
  }

  return (
    <div className="rounded-2xl border border-border-custom bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="destructive" className="gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          <Zap className="h-3 w-3" strokeWidth={2.5} />
          {t("badge")}
        </Badge>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom">
            {t("closesIn")}
          </div>
          <div className={cn("font-satoshi text-lg font-bold tabular-nums", urgent && "animate-pulse text-destructive")}>
            {expired ? t("resolving") : formatSpeedCountdown(secondsLeft)}
          </div>
        </div>
      </div>

      <div className={cn("rounded-xl p-4", sideBg)}>
        <div className={cn("text-[11px] font-bold uppercase tracking-wide", sideColor)}>
          {position.side === "over" ? t("up") : t("down")} @ {Math.round(entryOfferedProb * 100)}%
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-custom">
              {t("stake")}
            </div>
            <div className="font-satoshi text-xl font-bold tabular-nums">
              ${stake.toFixed(2)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-custom">
              {t("payoutIfWin")}
            </div>
            <div className={cn("font-satoshi text-xl font-bold tabular-nums", sideColor)}>
              ${potentialPayout.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-lg bg-bg p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-custom">{t("spotPrice")}</span>
          <span className="font-satoshi font-bold tabular-nums">
            {livePrice ? `$${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
          </span>
        </div>
        {!expired && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-custom">{t("currentValue")}</span>
            <span className={cn("font-satoshi font-bold tabular-nums", fairProfit !== null && fairProfit >= 0 ? "text-success" : "text-destructive")}>
              {fairValue !== null ? `$${fairValue.toFixed(2)}` : "—"}
            </span>
          </div>
        )}
      </div>

      {cashError && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
          {cashError}
        </div>
      )}

      {position.status === "open" && !expired && (
        <Button
          type="button"
          size="lg"
          onClick={handleCashout}
          disabled={cashLoading || isStale}
          className="h-12 w-full font-satoshi text-sm font-bold uppercase tracking-wide"
        >
          {cashLoading
            ? "…"
            : `${t("cashOut")}${estCashout !== null ? ` · $${estCashout.toFixed(2)}` : ""}`}
        </Button>
      )}

      {/* Resolving (position still open but market timer expired) — big
          "if you win" value so the user has something tangible to look at
          while the cron computes settlement (mig 362: 0-5s typical). */}
      {position.status === "open" && expired && (
        <div className="rounded-xl border border-border-custom bg-bg p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-custom">
            <span className="h-2 w-2 rounded-full bg-muted-custom animate-pulse" />
            {t("resolving")}
          </div>
          <div className="mt-1 text-xs text-muted-custom">{t("profitsSoon")}</div>
          <div className="mt-3 text-[10px] uppercase tracking-wide text-muted-custom">
            {t("ifYouWin")}
          </div>
          <div className="font-satoshi text-3xl font-black tabular-nums text-text">
            ${potentialPayout.toFixed(2)}
          </div>
        </div>
      )}

      {/* Won — big winnings card (replaces the small inline badge) */}
      {position.status === "won" && position.payout_amount && (
        <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom">
            {t("youWon")}
          </div>
          <div className="font-satoshi text-3xl font-black tabular-nums text-success">
            +${(Number(position.payout_amount) - stake).toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-muted-custom tabular-nums">
            {t("payoutIfWin")}: ${Number(position.payout_amount).toFixed(2)}
          </div>
        </div>
      )}

      {/* Lost — gentle "better luck next round" */}
      {position.status === "lost" && (
        <div className="rounded-lg bg-bg p-3 text-center text-sm">
          <div className="font-bold uppercase tracking-wide text-destructive">
            {t("lost")}
          </div>
          <div className="mt-1 text-xs text-muted-custom">{t("betterLuck")}</div>
        </div>
      )}

      {/* Cashed out / refunded — keep the existing small inline badge */}
      {(position.status === "cashed_out" || position.status === "refunded") && (
        <div className="rounded-lg bg-bg p-3 text-center text-sm">
          <span className="font-bold uppercase tracking-wide">
            {position.status === "cashed_out" && t("cashOut")}
            {position.status === "refunded" && t("voided")}
          </span>
          {position.payout_amount && (
            <span className="ml-2 font-satoshi tabular-nums">
              ${Number(position.payout_amount).toFixed(2)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
