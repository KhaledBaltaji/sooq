"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatCurrency, triggerHapticConfirm } from "@/lib/utils";
import { mapSpeedRpcError } from "@/lib/speed/errors";
import { speedSecondsLeftBucket } from "@/lib/speed/pricing";
import {
  useSpeedExecuteTrade,
  useSpeedCashout,
  type CashoutParitySnapshot,
  type TradeParitySnapshot,
} from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import {
  useSpeedTradeQuote,
  useSpeedCashoutQuote,
} from "@/hooks/use-speed-quote";
import { useTradeGating } from "@/hooks/use-trade-gating";
import { useCashoutGating } from "@/hooks/use-cashout-gating";
import type { SpeedMarket, SpeedPosition, SpeedSide } from "@/types/database";

const STAKE_PRESETS = [10, 50, 100, 1000];

/**
 * Fixed-bottom mobile trade bar for /speed/[id].
 *
 * Two states based on whether the user has an open position:
 *
 *   No position:
 *   ┌────────────────────────────────────────────────┐
 *   │       [ − ]   $5   [ + ]                       │  stake stepper
 *   │   [  UP 51% +$4.80  ]  [  DOWN 49% +$5.10  ]   │  one-click bets
 *   └────────────────────────────────────────────────┘
 *
 *   Open position:
 *   ┌────────────────────────────────────────────────┐
 *   │            [   CASH OUT  ·  $14.43   ]         │  one-tap cashout
 *   └────────────────────────────────────────────────┘
 *
 * Both Up/Down buttons fire `placeBet()` directly with no confirmation sheet.
 * The cash-out button fires `cashout()` directly. Stake stepper increments
 * by tap; presets cycle 1 → 5 → 10 → 25 → 1.
 *
 * Hidden on lg+ — desktop uses the sticky right-column trade panel instead.
 */
export function SpeedMobileTradeBar({
  market,
  position,
  livePrice,
  isStale,
  onBetPlaced,
}: {
  market: SpeedMarket;
  position: SpeedPosition | null;
  livePrice: number | null;
  isStale: boolean;
  onBetPlaced: () => void;
}) {
  const t = useTranslations("speed");
  // Phase 1 (2026-05-12): read errors from both hooks so the mobile bar can
  // surface every server rejection (rate limit 429, PARITY_DRIFT, IV_DRIFT,
  // balance, cap, etc). Before this change the mobile bar never rendered
  // these — taps silently failed and the user saw nothing.
  const { placeBet, loading: betLoading, error: betError } = useSpeedExecuteTrade();
  const { cashout, loading: cashLoading, error: cashError } = useSpeedCashout();
  const lastError = betError ?? cashError;
  const feeConfig = useSpeedFeeConfig();
  const { iv, realizedVol } = feeConfig;
  const [stake, setStake] = useState<number>(5);
  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    // Plan C: 100ms tick (was 250ms) — see speed-trade-panel.tsx for rationale.
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0 || market.status !== "open";

  // CRITICAL: All hooks must be called at the top level (React Rules of
  // Hooks). The component branches into no-position vs has-position UIs
  // below, but the hook calls must be unconditional. `enabled` gates the
  // actual network fetch — when irrelevant for the current branch the
  // query stays idle, no request fired, no rerender churn.
  const noPosition = !position || position.status !== "open";

  // Trade-mode quotes for both sides (used by no-position branch).
  const tradeQuotesEnabled =
    noPosition && !expired && !isStale && market.status === "open";
  const { quote: overQuote } = useSpeedTradeQuote(market.id, "over", {
    enabled: tradeQuotesEnabled,
  });
  const { quote: underQuote } = useSpeedTradeQuote(market.id, "under", {
    enabled: tradeQuotesEnabled,
  });

  // Cashout quote for the open-position branch.
  const cashoutQuoteEnabled =
    !noPosition && !!position && !expired && market.status === "open";
  const { quote: cashoutQuoteShared } = useSpeedCashoutQuote(
    position?.id ?? null,
    { enabled: cashoutQuoteEnabled },
  );

  // Hoisted at top-level so the gating hooks (which use useMemo internally)
  // satisfy React's Rules of Hooks. Their results are only consumed within
  // the matching branch below.
  // Mig 0028+: prefer realized-vol σ from RV cache so client matches server.
  const sigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;
  // T3.1: gate on RV cache being loaded — see speed-trade-panel.tsx for
  // the rationale. When useRealizedVol is OFF, gate is a no-op.
  const rvLoaded = !feeConfig.useRealizedVol || Boolean(realizedVol?.[market.asset]);

  // Plan C: OR-gating per side, computed at top level. Used by the
  // no-position branch's UP / DOWN buttons.
  const overGating = useTradeGating({
    tradeQuote: overQuote,
    livePrice,
    sigma,
    market,
    side: "over",
    secondsLeft,
    isStale,
    feeConfig,
  });
  const underGating = useTradeGating({
    tradeQuote: underQuote,
    livePrice,
    sigma,
    market,
    side: "under",
    secondsLeft,
    isStale,
    feeConfig,
  });
  // Plan C: OR-gating for cashout. Accepts position=null so this is safe
  // to call when the user has no open position.
  const cashoutGating = useCashoutGating({
    cashoutQuote: cashoutQuoteShared,
    livePrice,
    sigma,
    market,
    position: position ?? null,
    secondsLeft,
    isStale,
    feeConfig,
  });

  // Plan B2: submitting lock shared across UP / DOWN / CASHOUT buttons.
  // Hoisted to top-level so it persists across the no-position ↔ has-position
  // branch flip. Held from the instant of tap until the network round-trip
  // resolves — closes the pre-render window where a frustrated user could
  // fire two requests for the same intent.
  const submittingRef = useRef<string | null>(null);

  // ── No-position branch: stake stepper + Up/Down ────────────────────────
  if (!position || position.status !== "open") {
    const offeredOver = overGating.offeredForDisplay;
    const offeredUnder = underGating.offeredForDisplay;
    const fairOver = overGating.fairForDisplay;

    const upPayout = offeredOver ? stake / offeredOver : null;
    const downPayout = offeredUnder ? stake / offeredUnder : null;
    const upProfit = upPayout !== null ? upPayout - stake : null;
    const downProfit = downPayout !== null ? downPayout - stake : null;

    // Phase 1 (2026-05-12): block taps when the local/server quote has
    // diverged > 5% — UI already shows the stale price; letting the tap
    // through would just produce a PARITY_DRIFT toast after the round trip.
    const quoteStale = overGating.isQuoteStale || underGating.isQuoteStale;

    // Phase 1 (2026-05-12): inline hint when pricing inputs aren't ready
    // yet. Replaces the silent "button greys with no explanation" state
    // that previously made the bar look broken on first paint.
    const tradeQuoteLoading =
      !rvLoaded || (tradeQuotesEnabled && (overQuote === null || underQuote === null));

    // Plan C: gating booleans from the hook (local OR server).
    const canBetOver =
      !expired && !isStale && !quoteStale && fairOver !== null && stake > 0 && !betLoading &&
      !overGating.lateRejected && !overGating.nearDecidedReject &&
      !overGating.softBlocked && rvLoaded;
    const canBetUnder =
      !expired && !isStale && !quoteStale && fairOver !== null && stake > 0 && !betLoading &&
      !underGating.lateRejected && !underGating.nearDecidedReject &&
      !underGating.softBlocked && rvLoaded;

    const handleBet = async (side: SpeedSide) => {
      if (submittingRef.current !== null) return; // Plan B2: in-flight lock
      const allowed = side === "over" ? canBetOver : canBetUnder;
      if (!allowed) return;
      triggerHapticConfirm();
      // Mig 0030 / 0057 follow-up: only echo client-truthful inputs (spot,
      // bucket). IV / fair_prob / offered_prob are computed from globals
      // on the client but per-market on the server (mig 0049-0051), so
      // sending them caused PARITY_DRIFT on every 1m trade. Server treats
      // NULL as skip. See speed-trade-panel.tsx for full rationale.
      const parity: TradeParitySnapshot = {
        expectedSpot: livePrice ?? undefined,
        expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
      };
      // Plan B1: per-click UUID for idempotency.
      const idempotencyKey = crypto.randomUUID();
      submittingRef.current = idempotencyKey;
      try {
        const { error: err } = await placeBet(
          market.id,
          side,
          stake,
          parity,
          idempotencyKey,
        );
        if (!err) onBetPlaced();
      } finally {
        submittingRef.current = null;
      }
    };

    const cyclePreset = () => {
      const idx = STAKE_PRESETS.indexOf(stake);
      const next = idx === -1 ? 1 : (idx + 1) % STAKE_PRESETS.length;
      setStake(STAKE_PRESETS[next]);
    };

    const mappedError = lastError ? mapSpeedRpcError(lastError) : null;

    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border-custom bg-bg/95 backdrop-blur-sm pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-3 px-4"
        role="region"
        aria-label="Speed trade bar"
      >
        {/* Phase 1 (2026-05-12): error toast + loading hint. Error wins over
            loading when both are active. Previously this surface was empty
            so every server rejection (rate limit, parity drift, balance,
            cap) silently failed and the user saw nothing. */}
        {mappedError ? (
          <div
            className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="leading-tight">{mappedError.userMessage}</span>
          </div>
        ) : tradeQuoteLoading ? (
          <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            <span>{t("loadingPricing")}</span>
          </div>
        ) : null}

        {/* Stake stepper */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <button
            type="button"
            onClick={() => setStake(Math.max(1, stake - 1))}
            disabled={betLoading || expired}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-custom bg-surface text-text disabled:opacity-50"
            aria-label="Decrease stake"
          >
            <Minus className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={cyclePreset}
            className="font-satoshi text-2xl font-extrabold tabular-nums text-text px-3 py-0.5 rounded-md hover:bg-surface transition"
            aria-label={`Stake $${stake} — tap to cycle preset`}
          >
            ${stake}
          </button>
          <button
            type="button"
            onClick={() => setStake(stake + 1)}
            disabled={betLoading || expired}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-custom bg-surface text-text disabled:opacity-50"
            aria-label="Increase stake"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Up / Down buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleBet("over")}
            disabled={!canBetOver}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-4 py-3 font-satoshi font-bold text-white shadow-sm transition active:translate-y-px",
              "bg-success disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[56px]",
            )}
          >
            {/* Plan B3: spinner reads as "active" within one animation frame
                of the tap, before React re-renders with betLoading=true. */}
            {betLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base uppercase tracking-wide">{t("up")}</span>
                  <span className="text-base font-extrabold tabular-nums">
                    {offeredOver !== null ? `${Math.round(offeredOver * 100)}%` : "—"}
                  </span>
                </div>
                {upProfit !== null && (
                  <span className="text-[11px] font-bold tabular-nums opacity-90">
                    +{formatCurrency(upProfit)}
                  </span>
                )}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleBet("under")}
            disabled={!canBetUnder}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-4 py-3 font-satoshi font-bold text-white shadow-sm transition active:translate-y-px",
              "bg-destructive disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[56px]",
            )}
          >
            {/* Plan B3: see UP button. */}
            {betLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base uppercase tracking-wide">{t("down")}</span>
                  <span className="text-base font-extrabold tabular-nums">
                    {offeredUnder !== null ? `${Math.round(offeredUnder * 100)}%` : "—"}
                  </span>
                </div>
                {downProfit !== null && (
                  <span className="text-[11px] font-bold tabular-nums opacity-90">
                    +{formatCurrency(downProfit)}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Open-position branch: one-tap CASH OUT ─────────────────────────────
  const stakeAmt = Number(position.stake);
  const entryProb = Number(position.entry_offered_prob);

  // Plan C: gating booleans + display values from the hoisted useCashoutGating
  // hook. OR-gated: server flag OR local predicate, whichever restricts first.
  const cashoutQuote = cashoutQuoteShared;
  const cashoutLockedLate = cashoutGating.cashoutLockedLate;
  const cashoutLockedNearDecided = cashoutGating.cashoutLockedNearDecided;
  const cashoutAtCap = cashoutGating.cashoutAtCap;
  const cashoutLocked = cashoutGating.cashoutLocked;
  const estCashout = cashoutGating.cashoutAmountForDisplay;
  // Expected settlement payout shown in the cap-edge tooltip / message.
  const expectedSettlementPayout =
    cashoutQuote?.expected_settlement_payout ??
    (entryProb > 0 ? stakeAmt / entryProb : 0);

  const handleCashout = async () => {
    if (submittingRef.current !== null) return; // Plan B2: in-flight lock
    if (cashLoading || expired || cashoutLocked) return;
    triggerHapticConfirm();
    // Mig 0030 / 0057 follow-up: only echo client-truthful inputs (spot,
    // bucket). IV / markProb / cashoutAmount diverge between client and
    // server when matrix + CLV are active; server treats NULL as skip.
    const parity: CashoutParitySnapshot = {
      expectedSpot: livePrice ?? undefined,
      expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
    };
    const idempotencyKey = crypto.randomUUID();
    submittingRef.current = idempotencyKey;
    try {
      // Plan E: pass marketId so the cashout hook can flip the correct
      // (userId, marketId)-scoped query keys for instant UI update.
      await cashout(position.id, parity, idempotencyKey, market.id);
    } finally {
      submittingRef.current = null;
    }
  };

  let cashoutLabel: string;
  if (cashLoading) {
    cashoutLabel = "";
  } else if (cashoutLockedLate) {
    cashoutLabel = t("cashoutLockedLate");
  } else if (cashoutLockedNearDecided) {
    cashoutLabel = t("cashoutLockedNearDecided");
  } else if (cashoutAtCap) {
    // Copy fix (audit item 4): add "if you win" caveat so user knows the
    // shown amount only pays if they're correct at settlement.
    cashoutLabel = `If you win at settlement: ${formatCurrency(expectedSettlementPayout)} · cashout currently unavailable`;
  } else if (estCashout !== null) {
    cashoutLabel = `${t("cashOut")} · ${formatCurrency(estCashout)}`;
  } else {
    cashoutLabel = t("cashOut");
  }

  const mappedError = lastError ? mapSpeedRpcError(lastError) : null;
  // Phase 1: cashout-quote loading hint.
  const cashoutQuoteLoading = cashoutQuoteEnabled && cashoutQuote === null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border-custom bg-bg/95 backdrop-blur-sm pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-3 px-4"
      role="region"
      aria-label="Speed cashout bar"
    >
      {/* Phase 1 (2026-05-12): error toast + loading hint — mirrors the
          no-position branch. Error wins over loading. */}
      {mappedError ? (
        <div
          className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="leading-tight">{mappedError.userMessage}</span>
        </div>
      ) : cashoutQuoteLoading ? (
        <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span>{t("loadingPricing")}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleCashout}
        disabled={cashLoading || expired || isStale || cashoutLocked}
        className={cn(
          "flex w-full items-center justify-center rounded-xl px-4 py-3 font-satoshi text-base font-extrabold uppercase tracking-wide text-white shadow-sm transition active:translate-y-px",
          "bg-warning disabled:opacity-50 disabled:cursor-not-allowed",
          "min-h-[56px]",
        )}
      >
        {cashLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          cashoutLabel
        )}
      </button>
    </div>
  );
}
