"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, triggerHapticConfirm } from "@/lib/utils";
import {
  durationToSeconds,
  formatSpeedCountdown,
  isUrgent,
  speedSecondsLeftBucket,
} from "@/lib/speed/pricing";
import { mapSpeedRpcError } from "@/lib/speed/errors";
import type { SpeedMarket, SpeedPosition } from "@/types/database";
import {
  useSpeedCashout,
  type CashoutParitySnapshot,
} from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import { useSpeedCashoutQuote } from "@/hooks/use-speed-quote";
import { useCashoutGating } from "@/hooks/use-cashout-gating";

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
  const { iv, realizedVol } = feeConfig;
  const totalSeconds = durationToSeconds(market.duration);
  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    // Plan C: 100ms tick (was 250ms) — see speed-trade-panel.tsx for rationale.
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0;
  const urgent = isUrgent(totalSeconds, secondsLeft);

  const stake = Number(position.stake);
  const entryOfferedProb = Number(position.entry_offered_prob);
  const payoutPerDollar = entryOfferedProb > 0 ? 1 / entryOfferedProb : 0;
  const potentialPayout = stake * payoutPerDollar;

  // Mig 0034+0044 follow-up: authoritative server cashout quote.
  // _speed_cashout_margin reads per-market values from speed_market_config
  // (mig 0050-0051) and the matrix correction the client can't replicate.
  // Fetched every 750ms while the position is open; falls back to local
  // estimate while loading.
  const cashoutEnabled = !expired && position.status === "open";
  const { quote: cashoutQuote } = useSpeedCashoutQuote(position.id, {
    enabled: cashoutEnabled,
  });

  // Plan C: OR-gating from the centralized hook. Local helper OR server flag,
  // whichever restricts first. Replaces the previous `server ?? local`
  // preference that lagged 1-2s behind the chart.
  const sigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
  const cashoutGating = useCashoutGating({
    cashoutQuote,
    livePrice,
    sigma,
    market,
    position,
    secondsLeft,
    isStale,
    feeConfig,
  });

  // Only estCashout is consumed by this panel (label rendering + button).
  // The hook exposes markProb / isWinning / margin / ivUsed for callers that
  // need them; position panel doesn't.
  const estCashout = cashoutGating.cashoutAmountForDisplay;

  // Preserve the position panel's prior gating semantics: only late + near-
  // decided block the cashout button (cap-edge does not gate here — the
  // panel displays the cashout amount even at cap; mobile bar handles cap
  // separately).
  const cashoutLockedLate = cashoutGating.cashoutLockedLate;
  const cashoutLockedNearDecided = cashoutGating.cashoutLockedNearDecided;
  const cashoutLocked = cashoutLockedLate || cashoutLockedNearDecided;

  const sideColor = position.side === "over" ? "text-success" : "text-destructive";
  const sideBg = position.side === "over" ? "bg-success/10" : "bg-destructive/10";

  // Mig 0030 / 0057 follow-up: only echo client-truthful inputs (spot,
  // bucket). expectedIv / expectedMarkProb / expectedCashoutAmount come
  // from client-side computation that uses globals while the server's
  // _speed_cashout_margin and pricing_apply read per-market from
  // speed_market_config (mig 0050-0051). They diverged silently.
  // Server treats NULL as skip. See speed-trade-panel.tsx for full
  // rationale; cashout follows the same pattern.
  function buildParitySnapshot(): CashoutParitySnapshot {
    return {
      expectedSpot: livePrice ?? undefined,
      expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
    };
  }

  // Plan B2: submitting lock — see speed-trade-panel.tsx for rationale.
  const submittingRef = useRef<string | null>(null);

  async function handleCashout() {
    if (submittingRef.current !== null) return;
    if (cashLoading || expired || cashoutLocked) return;
    triggerHapticConfirm();
    // Plan B1: per-click UUID for idempotency.
    const idempotencyKey = crypto.randomUUID();
    submittingRef.current = idempotencyKey;
    try {
      // Plan E: pass marketId so the cashout hook can flip the correct
      // (userId, marketId)-scoped query keys.
      await cashout(position.id, buildParitySnapshot(), idempotencyKey, market.id);
    } finally {
      submittingRef.current = null;
    }
  }

  const mappedError = cashError ? mapSpeedRpcError(cashError) : null;

  // Cashout button label — surfaces the actual gating reason instead of going grey.
  let cashoutLabel: string;
  if (cashLoading) {
    cashoutLabel = ""; // spinner instead of text
  } else if (cashoutLockedLate) {
    cashoutLabel = t("cashoutLockedLate");
  } else if (cashoutLockedNearDecided) {
    cashoutLabel = t("cashoutLockedNearDecided");
  } else if (estCashout !== null) {
    cashoutLabel = `${t("cashOut")} · ${formatCurrency(estCashout)}`;
  } else {
    cashoutLabel = t("cashOut");
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
              {formatCurrency(stake)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-custom">
              {t("payoutIfWin")}
            </div>
            <div className={cn("font-satoshi text-xl font-bold tabular-nums", sideColor)}>
              {formatCurrency(potentialPayout)}
            </div>
          </div>
        </div>
      </div>

      {/* Mig 0028: hide fair_value / "current value" — user compares cashout
          button vs stake, not vs fair value. Casino framing. */}
      <div className="space-y-2 rounded-lg bg-bg p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-custom">{t("spotPrice")}</span>
          <span className="font-satoshi font-bold tabular-nums">
            {livePrice ? formatCurrency(livePrice) : "—"}
          </span>
        </div>
      </div>

      {mappedError && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
          {mappedError.userMessage}
        </div>
      )}

      {position.status === "open" && !expired && (
        <div className="space-y-1.5">
          <Button
            type="button"
            size="lg"
            onClick={handleCashout}
            disabled={cashLoading || isStale || cashoutLocked}
            className="h-12 w-full font-satoshi text-sm font-bold uppercase tracking-wide"
          >
            {cashLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              cashoutLabel
            )}
          </Button>
          {estCashout !== null && !cashoutLocked && !cashLoading && (
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span
                className={cn(
                  "font-satoshi text-xs font-bold tabular-nums",
                  estCashout - stake > 0.005
                    ? "text-success"
                    : estCashout - stake < -0.005
                      ? "text-destructive"
                      : "text-muted-custom",
                )}
              >
                {estCashout - stake > 0.005 ? "+" : ""}
                {formatCurrency(estCashout - stake)}
              </span>
              <span className="text-[11px] text-muted-custom">
                {t("ifYouWinSettlement")}: {formatCurrency(potentialPayout)}
              </span>
            </div>
          )}
        </div>
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
            {formatCurrency(potentialPayout)}
          </div>
        </div>
      )}

      {/* Won — big winnings card */}
      {position.status === "won" && position.payout_amount && (
        <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom">
            {t("youWon")}
          </div>
          <div className="font-satoshi text-3xl font-black tabular-nums text-success">
            +{formatCurrency(Number(position.payout_amount) - stake)}
          </div>
          <div className="mt-1 text-xs text-muted-custom tabular-nums">
            {t("payoutIfWin")}: {formatCurrency(Number(position.payout_amount))}
          </div>
        </div>
      )}

      {position.status === "lost" && (
        <div className="rounded-lg bg-bg p-3 text-center text-sm">
          <div className="font-bold uppercase tracking-wide text-destructive">
            {t("lost")}
          </div>
          <div className="mt-1 text-xs text-muted-custom">{t("betterLuck")}</div>
        </div>
      )}

      {(position.status === "cashed_out" || position.status === "refunded") && (
        <div className="rounded-lg bg-bg p-3 text-center text-sm">
          <span className="font-bold uppercase tracking-wide">
            {position.status === "cashed_out" && t("cashOut")}
            {/* Copy fix (audit #5): server stores 'refunded', not 'voided'.
                On legacy push (tie_loser_rule_active = false) this is a push
                refund — both sides got their stake back. Render the correct
                label and add a small "Push refund" subtitle so the user
                understands why they got their money back. */}
            {position.status === "refunded" && t("refunded")}
          </span>
          {position.payout_amount && (
            <span className="ml-2 font-satoshi tabular-nums">
              {formatCurrency(Number(position.payout_amount))}
            </span>
          )}
          {position.status === "refunded" && market.tie_loser_rule_active !== true && (
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-custom">
              {t("pushRefund")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
