"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate as fmAnimate } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { cn, formatCurrency, formatNumber, triggerHapticConfirm } from "@/lib/utils";
import {
  speedFairProbOver,
  speedMaxStakeForOffered,
  speedOfferedProb,
  speedSecondsLeftBucket,
} from "@/lib/speed/pricing";
import { mapSpeedRpcError } from "@/lib/speed/errors";
import type { SpeedMarket, SpeedSide } from "@/types/database";
import {
  useSpeedExecuteTrade,
  type TradeParitySnapshot,
} from "@/hooks/use-speed-trade";
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";
import { useSpeedTradeQuote } from "@/hooks/use-speed-quote";
import { useTradeGating } from "@/hooks/use-trade-gating";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";

// Stake bounds for the trade UI. Server is authoritative — these are
// just guardrails so the input + preset chips reflect what's currently
// achievable. Server caps live in fee_config:
//   speed_stake_max_<duration>_usd (per-bet, per-duration; mig 0028+)
//   speed_per_user_per_market_cap_usd (per-side per market; mig 0028+)
// Falls back to a generous SPEED_STAKE_MAX if fee_config doesn't have
// the per-duration row yet — server will reject above the real cap.
const SPEED_STAKE_MIN = 1;
const SPEED_STAKE_MAX = 1000;
const SPEED_STAKE_PRESETS = [10, 50, 100, 1000] as const;
const MAX_AMOUNT_INPUT = 1000;

export function SpeedTradePanel({
  market,
  livePrice,
  isStale,
  onBetPlaced,
}: {
  market: SpeedMarket;
  livePrice: number | null;
  isStale: boolean;
  onBetPlaced: () => void;
}) {
  const t = useTranslations("speed");
  const tTrade = useTranslations("trade");
  const { placeBet, loading, error } = useSpeedExecuteTrade();
  const feeConfig = useSpeedFeeConfig();
  const { iv, realizedVol } = feeConfig;
  const { user } = useUser();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const [side, setSide] = useState<SpeedSide>("over");
  const [amount, setAmount] = useState<number>(0);
  const [amountInput, setAmountInput] = useState("");
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const closesAt = new Date(market.closes_at).getTime();
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    // Plan C: 100ms tick (was 250ms) so secondsLeft-driven gating predicates
    // (last-10s reject, last-30s near-decided block) update 2.5× faster.
    // CPU cost is one Date.now() + setState per mounted panel.
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((closesAt - now) / 1000));
  const expired = secondsLeft <= 0 || market.status !== "open";

  const strike = Number(market.strike_price);
  const balance = user?.balance_usd ?? 0;

  // Pricing math — odds are always derived from the last-known oracle price
  // so the UI stays informative through transient realtime drops. Staleness
  // gates only trade execution (canTrade), not display.
  // Mig 0028+: prefer realized-volatility σ when available so the client-
  // displayed offered prob matches what `speed_execute_trade` will price
  // the bet at. Falls back to fee_config IV when RV is missing.
  const sigma = realizedVol?.[market.asset]?.rv ?? iv[market.asset] ?? 0.6;

  // T3.1: gate trade entry on RV cache being loaded. If the kill switch
  // for RV is OFF, the server is reading speed_iv_btc directly, so the
  // gate is a no-op (any sigma the client uses matches).
  // If RV is ON but the snapshot hasn't arrived yet, sigma falls back to
  // the static IV — which may differ from the RV the server is using by
  // more than the IV_DRIFT tolerance, producing a confusing reject after
  // the user taps Bet. Block until snapshot arrives.
  const rvLoaded = !feeConfig.useRealizedVol || Boolean(realizedVol?.[market.asset]);

  // Local estimates for the OPPOSITE side's pill (we don't fetch a quote
  // for the unselected side — would double bandwidth). The selected side
  // uses the gating hook below which already handles local + server.
  const localFairOver = livePrice
    ? speedFairProbOver(livePrice, strike, secondsLeft, sigma)
    : null;
  const localOfferedOver =
    localFairOver !== null
      ? speedOfferedProb(localFairOver, "over", feeConfig, secondsLeft)
      : null;
  const localOfferedUnder =
    localFairOver !== null
      ? speedOfferedProb(localFairOver, "under", feeConfig, secondsLeft)
      : null;

  // Mig 0034+0044: server-authoritative quote for the selected side.
  // Server applies _speed_pricing_apply (matrix) and _speed_apply_user_shading
  // (CLV throttle) — neither replicable client-side.
  const { quote: tradeQuote } = useSpeedTradeQuote(
    market?.id ?? null,
    side,
    { enabled: !!user && !expired && market.status === "open" },
  );

  // Plan C: monotonic OR-gating. Local helper (fresh, WS-driven) OR server
  // flag (1s stale but sees shading + matrix). Whichever restricts first
  // wins. Replaces the old `server ?? local` preference that lagged 1-2s.
  const gating = useTradeGating({
    tradeQuote,
    livePrice,
    sigma,
    market,
    side,
    secondsLeft,
    isStale,
    feeConfig,
  });

  const offeredForSide = gating.offeredForDisplay;
  const fairForSide = gating.fairForDisplay;
  const lateRejected = gating.lateRejected;
  const nearDecidedReject = gating.nearDecidedReject;
  const softBlocked = gating.softBlocked;

  // Pill display (both sides) — informational, local estimate is fine for
  // the unselected side. Selected side reads from the gating hook (server-
  // first display).
  const offeredOver =
    side === "over" ? offeredForSide : localOfferedOver;
  const offeredUnder =
    side === "under" ? offeredForSide : localOfferedUnder;
  const fairOver =
    side === "over" ? fairForSide : localFairOver;

  const payoutPerDollar = offeredForSide ? 1 / offeredForSide : null;
  const toWin = payoutPerDollar && amount > 0 ? amount * payoutPerDollar : 0;

  // Per-duration stake max from fee_config (admin-tunable per duration),
  // falling back to the generic UI ceiling.
  const stakeMaxForDuration =
    feeConfig.stakeMaxByDuration[market.duration] ?? SPEED_STAKE_MAX;

  // Mig 0034: dynamic max-stake formula — caps stake by per-trade limit,
  // per-ticket payout cap, and per-side liability cap. Tightens for deep
  // underdog odds. Server enforces; client mirrors for inline hint.
  const dynamicStakeMax =
    offeredForSide !== null
      ? speedMaxStakeForOffered(market.duration, offeredForSide, feeConfig)
      : stakeMaxForDuration;

  // Auth-gate cascade mirroring prediction-market trade-panel.
  const isZeroBalance = !user || balance <= 0;
  const hasBalance = !!user && balance >= amount && amount > 0;
  const aboveMin = amount >= SPEED_STAKE_MIN;
  const aboveMax = amount > stakeMaxForDuration;
  // Mig 0034: dynamic stake limit (tighter than configured trade max for low-prob bets)
  const aboveDynamicMax = amount > dynamicStakeMax;
  // Phase 5b (2026-05-12): removed `!isStale` silent gate. The button no
  // longer goes silently dead on a brief WS hiccup — server is authoritative
  // on staleness and rejects with a visible error if the price is truly old.
  // The "Reconnecting" banner below (line 580) already informs the user
  // when the WS is stale, so they know what's happening.
  const canTrade =
    !expired &&
    fairOver !== null &&
    aboveMin &&
    !aboveMax &&
    !aboveDynamicMax &&
    hasBalance &&
    !loading &&
    !lateRejected &&
    !nearDecidedReject &&
    !softBlocked &&
    rvLoaded;

  const handleAmountInput = useCallback((val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    let intPart = parts[0] || "";
    if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
    if (intPart.length > 3) return;
    if (parts[1] && parts[1].length > 2) return;
    const formatted = parts.length === 2 ? `${intPart}.${parts[1]}` : intPart;
    const num = parseFloat(formatted);
    if (!isNaN(num) && num > MAX_AMOUNT_INPUT) return;
    setAmountInput(formatted);
    setAmount(isNaN(num) ? 0 : num);
  }, []);

  const animRef = useRef<ReturnType<typeof fmAnimate> | null>(null);

  const animateToValue = useCallback(
    (target: number) => {
      animRef.current?.stop();
      const from = amount;
      animRef.current = fmAnimate(from, target, {
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (v) => {
          setAmountInput(Math.round(v).toString());
        },
        onComplete: () => setAmountInput(target.toString()),
      });
      setAmount(target);
    },
    [amount],
  );

  const handleAddPreset = useCallback(
    (preset: number) => {
      const next = Math.min(amount + preset, SPEED_STAKE_MAX);
      animateToValue(next);
    },
    [amount, animateToValue],
  );

  const handleMax = useCallback(() => {
    const cap = Math.min(SPEED_STAKE_MAX, Math.floor(balance));
    if (cap >= SPEED_STAKE_MIN) animateToValue(cap);
  }, [balance, animateToValue]);

  const handleAmountClick = () => inputRef.current?.focus();

  const inlineHint = useMemo(() => {
    if (amount > 0 && amount < SPEED_STAKE_MIN) {
      return {
        text: tTrade("hintMinTrade", { min: `$${SPEED_STAKE_MIN}` }),
        type: "error" as const,
      };
    }
    if (aboveMax) {
      return {
        text: tTrade("hintMaxTrade", { max: formatCurrency(stakeMaxForDuration) }),
        type: "warning" as const,
      };
    }
    if (user && amount >= SPEED_STAKE_MIN && amount > balance) {
      const needed = amount - balance;
      return {
        text: tTrade("hintNeedMore", { needed: formatCurrency(needed) }),
        type: "error" as const,
      };
    }
    if (lateRejected) {
      return {
        text: t("entryLockedLate"),
        type: "warning" as const,
      };
    }
    if (nearDecidedReject) {
      return {
        text: t("entryLockedNearDecided"),
        type: "warning" as const,
      };
    }
    // Mig 0034 (soft-block) — copy revised in mig 0058 follow-up. Old
    // "Market closing" euphemism misled users (showed at 1+ min remaining).
    // Honest text: this side is at the price ceiling, trade the other side.
    if (softBlocked) {
      return {
        text: "Odds too one-sided here — try the other side",
        type: "warning" as const,
      };
    }
    // Mig 0034: dynamic stake max (tighter than configured trade max for low-prob bets)
    if (
      aboveDynamicMax &&
      !aboveMax &&
      amount >= SPEED_STAKE_MIN
    ) {
      return {
        text: `Limit reached — your max trade size is ${formatCurrency(dynamicStakeMax)}`,
        type: "warning" as const,
      };
    }
    // Plan C5: local-vs-server divergence indicator. Fires only when nothing
    // else is wrong but the polled quote has drifted >5% from the WS-driven
    // local computation. Surfaces a soft "Refreshing…" hint so the user
    // doesn't act on stale display odds. Auto-clears on next quote arrival.
    if (gating.isQuoteStale) {
      return {
        text: "Refreshing odds…",
        type: "warning" as const,
      };
    }
    return null;
  }, [
    amount,
    aboveMax,
    aboveDynamicMax,
    dynamicStakeMax,
    balance,
    user,
    tTrade,
    t,
    stakeMaxForDuration,
    lateRejected,
    nearDecidedReject,
    softBlocked,
    gating.isQuoteStale,
  ]);

  const getButtonLabel = () => {
    if (loading) return tTrade("processing");
    if (isZeroBalance) return tTrade("depositToTrade");
    if (!hasBalance && amount > 0) return tTrade("insufficientBalance");
    if (lateRejected) return t("entryLockedLate");
    if (nearDecidedReject) return t("entryLockedNearDecided");
    if (softBlocked) return "Side at limit";
    return `${t("placeBet")} · ${side === "over" ? t("up") : t("down")} · ${formatCurrency(amount)}`;
  };

  const mappedError = error ? mapSpeedRpcError(error) : null;

  const isButtonDisabled = () => {
    if (loading) return true;
    if (isZeroBalance) return false; // clickable for deposit/login
    return !canTrade;
  };

  // Mig 0030: quote/execute parity snapshot. Mig 0057 follow-up:
  // expectedIv / expectedFairProb / expectedOfferedProb are intentionally
  // OMITTED. The client computes those from globals (fee_config + a
  // duration-agnostic /volatility hook) while the server reads from
  // per-market sources (speed_market_config per mig 0049-0051,
  // speed_volatility_cache per mig 0029). They diverged silently —
  // 214% IV drift on 5m, 2.86% spread drift on 1m — and rejected every
  // trade with IV_DRIFT / PARITY_DRIFT. Server treats NULL as skip.
  // We keep the universally-comparable inputs (spot, bucket) so basic
  // staleness protection remains. Full parity restoration requires a
  // proper /api/speed/quote echo hook — tracked as follow-up.
  function buildParitySnapshot(): TradeParitySnapshot {
    return {
      expectedSpot: livePrice ?? undefined,
      expectedSecondsLeftBucket: speedSecondsLeftBucket(secondsLeft),
    };
  }

  // Plan B2: submitting lock. Held from the instant of tap until the network
  // round-trip completes (success or error). A second click while a request
  // is in flight short-circuits before any network call fires. Closes the
  // perceived gap between tap and React's next render in which `loading`
  // becomes true.
  const submittingRef = useRef<string | null>(null);

  async function handleButtonClick() {
    if (submittingRef.current !== null) return; // second click ignored
    triggerHapticConfirm();
    // Auth-gate cascade — no user → login, no balance → deposit, then bet.
    if (!user) {
      openLoginModal();
      return;
    }
    if (balance <= 0) {
      openDepositModal();
      return;
    }
    if (!canTrade) return;
    // Plan B1: per-click UUID. Browser-level retries of the same Request
    // reuse this UUID, so server dedups correctly. Distinct clicks each
    // get a new UUID → each creates a real position.
    const idempotencyKey = crypto.randomUUID();
    submittingRef.current = idempotencyKey;
    try {
      const { error: err } = await placeBet(
        market.id,
        side,
        amount,
        buildParitySnapshot(),
        idempotencyKey,
      );
      if (!err) onBetPlaced();
    } finally {
      submittingRef.current = null;
    }
  }

  // 3D pushable button — mirror of trade-panel.tsx with green/red shadows.
  const buttonBase = cn(
    "w-full h-14 font-black font-satoshi uppercase tracking-widest rounded-lg cursor-pointer text-white",
    "transition-all duration-[80ms]",
    "!border-0 !ring-0 !outline-none bg-clip-border",
  );
  const buttonColor =
    side === "over"
      ? "bg-success hover:brightness-110 shadow-[0_4px_0_0px_rgba(15,90,40,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(15,90,40,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,90,40,0.9)]"
      : "bg-destructive hover:brightness-110 shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] hover:translate-y-[1px] hover:shadow-[0_3px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]";
  const disabledStyle = "opacity-50 !translate-y-0 cursor-not-allowed";

  return (
    <div className="bg-surface rounded-lg border border-border-custom p-5">
      {/* UP / DOWN side selector — label + offered probability, mirrors the
          YES/NO buttons in trade-panel.tsx and the mobile speed bar. */}
      <div className="grid grid-cols-2 gap-3 mb-5 h-[76px]">
        <button
          type="button"
          onClick={() => setSide("over")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "over"
              ? "border-2 border-success bg-success/10 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated",
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider mb-1",
              side === "over" ? "text-success" : "text-muted-custom",
            )}
          >
            {t("up")}
          </span>
          <span
            className={cn(
              "text-xl font-black font-satoshi tabular-nums",
              side === "over" ? "text-success" : "text-text",
            )}
          >
            {offeredOver !== null ? `${Math.round(offeredOver * 100)}%` : "—"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSide("under")}
          className={cn(
            "flex flex-col items-center justify-center p-3 rounded-md transition-all cursor-pointer active:scale-95",
            side === "under"
              ? "border-2 border-destructive bg-destructive/10 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
              : "border border-border-custom bg-bg hover:bg-elevated",
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider mb-1",
              side === "under" ? "text-destructive" : "text-muted-custom",
            )}
          >
            {t("down")}
          </span>
          <span
            className={cn(
              "text-xl font-black font-satoshi tabular-nums",
              side === "under" ? "text-destructive" : "text-text",
            )}
          >
            {offeredUnder !== null ? `${Math.round(offeredUnder * 100)}%` : "—"}
          </span>
        </button>
      </div>

      {/* Stake input + secondary info row */}
      <div className="space-y-4">
        <div>
          <div
            className="flex items-end justify-between cursor-text"
            onClick={handleAmountClick}
          >
            <div className="flex items-center gap-1 text-sm text-muted-custom font-medium pb-1">
              <span>$ USD</span>
              <ChevronDown className="w-3 h-3" />
            </div>
            <div className="flex items-baseline">
              <span className="text-3xl font-satoshi font-black text-dim">$</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => handleAmountInput(e.target.value)}
                placeholder="0"
                className="bg-transparent text-right text-text font-black font-satoshi text-3xl placeholder:text-dim tabular-nums caret-yes max-w-[200px]"
                style={{
                  width: `${Math.max(1, amountInput.length || 1)}ch`,
                  outline: "none",
                  border: "none",
                  boxShadow: "none",
                }}
                aria-label="Stake amount"
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-dim mt-1">
            <span>
              {tTrade("hintMaxTrade", { max: formatCurrency(stakeMaxForDuration) })}
            </span>
            <span>
              {tTrade("balanceLabel")} {user ? formatCurrency(balance) : "$0.00"}
            </span>
          </div>
          {inlineHint && (
            <p
              className={cn(
                "text-[11px] text-right mt-1",
                inlineHint.type === "error" ? "text-error" : "text-warning",
              )}
            >
              {inlineHint.text}
            </p>
          )}
        </div>

        {/* Quick-stake chips */}
        <div className="flex gap-2">
          {SPEED_STAKE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleAddPreset(preset)}
              className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
            >
              +${preset}
            </button>
          ))}
          <button
            type="button"
            onClick={handleMax}
            className="flex-1 py-2 text-[11px] font-medium rounded-full border border-border-custom bg-bg hover:bg-elevated text-muted-custom transition-colors cursor-pointer"
          >
            {tTrade("max")}
          </button>
        </div>

        {/* "To win" row — only when stake meets minimum and pricing is available */}
        {amount >= SPEED_STAKE_MIN && toWin > 0 && (
          <div className="pt-4 border-t border-border-custom">
            <div className="flex items-end justify-between">
              <div className="flex items-end gap-1.5">
                <span className="text-sm text-muted-custom">{tTrade("toWin")}</span>
                <button
                  type="button"
                  onClick={() => setShowFeeBreakdown((s) => !s)}
                  className="text-dim hover:text-muted-custom transition-colors cursor-pointer"
                  aria-label="Show breakdown"
                >
                  <Info className="w-3 h-3" />
                </button>
              </div>
              <span className="text-2xl font-black font-satoshi text-success tabular-nums">
                ${formatNumber(toWin)}
              </span>
            </div>

            {showFeeBreakdown && (
              <div className="mt-3 pt-3 border-t border-border-custom/50 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{tTrade("amount")}</span>
                  <span className="text-text tabular-nums">{formatCurrency(amount)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-custom">{tTrade("payoutIfWins")}</span>
                  <span className="text-success tabular-nums">{formatCurrency(toWin)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {mappedError && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
          {mappedError.userMessage}
        </div>
      )}

      {isStale && (
        <div className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning ring-1 ring-warning/30">
          {t("reconnecting")}
        </div>
      )}

      {/* Confirm button — chunkier 3D pushable */}
      <div className="mt-5">
        <Button
          type="button"
          onClick={handleButtonClick}
          disabled={isButtonDisabled()}
          className={cn(buttonBase, buttonColor, isButtonDisabled() && disabledStyle)}
        >
          {/* Plan B3: in-button spinner reads as "active" the same animation
              frame the user taps, before React re-renders with loading=true. */}
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              {getButtonLabel()}
            </span>
          ) : (
            getButtonLabel()
          )}
        </Button>
      </div>

    </div>
  );
}
