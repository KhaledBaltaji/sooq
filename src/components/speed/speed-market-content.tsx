"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, MinusCircle, XCircle, Share2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeedMarket } from "@/hooks/use-speed-market";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { useSpeedPosition } from "@/hooks/use-speed-position";
import { useUser } from "@/lib/auth/hooks";
import { SpeedTradePanel } from "@/components/speed/speed-trade-panel";
import { SpeedPositionPanel } from "@/components/speed/speed-position-panel";
import {
  SpeedPriceChart,
  SPEED_CHART_TYPE_KEY,
  readSpeedChartType,
  type SpeedChartType,
} from "@/components/speed/speed-price-chart";
import { CandlestickChart, LineChart as LineChartIcon } from "lucide-react";
import { SpeedAboutMarket } from "@/components/speed/speed-about-market";
import { SpeedAssetHeader } from "@/components/speed/speed-asset-header";
import { SpeedWindowPills } from "@/components/speed/speed-window-pills";
import { SpeedMobileTradeBar } from "@/components/speed/speed-mobile-trade-bar";
import {
  durationToSeconds,
  formatSpeedCountdown,
  isMarketAligned,
} from "@/lib/speed/pricing";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import { toast } from "sonner";
import type { SpeedMarket } from "@/types/database";
import { SpeedRoundV2 } from "./speed-round-v2";

interface SpeedMarketContentProps {
  params: Promise<{ id: string }>;
  inModal?: boolean;
  /**
   * Set to true once the modal slide-out animation begins. Pre-unmounts
   * the heaviest child (`SpeedPriceChart`, which holds a lightweight-charts
   * canvas instance with pan/zoom listeners + GPU resources) so the bulk
   * of the teardown work happens BEFORE the modal route unmounts. Without
   * this, the entire dispose runs synchronously on the back-nav frame and
   * causes a perceptible jitter.
   */
  isClosing?: boolean;
  /**
   * Custom back handler — wired by the mobile modal route so the v2 Strip's
   * chevron triggers the slide-out animation before navigating. When
   * absent, `router.back()` is used.
   */
  onBack?: () => void;
}

export function SpeedMarketContent({ params, inModal = false, isClosing = false, onBack }: SpeedMarketContentProps) {
  const { id } = use(params);
  const t = useTranslations("speed");
  const tMarket = useTranslations("market");
  const router = useRouter();
  const { market, loading: mLoading } = useSpeedMarket(id);
  const { price, isStale, loading: oLoading } = useSpeedOracleLatest("BTC");
  const { position } = useSpeedPosition(id);
  const { user } = useUser();
  const [bumpKey, setBumpKey] = useState(0);
  const redirectFiredRef = useRef(false);
  const [chartType, setChartType] = useState<SpeedChartType>(readSpeedChartType);
  const handleChartTypeChange = useCallback((next: SpeedChartType) => {
    setChartType(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SPEED_CHART_TYPE_KEY, next);
      }
    } catch {
      // ignore — private mode / quota
    }
  }, []);

  // Sticky header on mobile — shows compact title + countdown bar when the
  // main header scrolls out of view. Mirrors prediction-market behavior.
  // Skipped when rendered inside the modal overlay (modal has its own header).
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inModal) return;
    const handleScroll = () => {
      const el = titleRef.current;
      if (!el) return;
      setShowStickyHeader(el.getBoundingClientRect().bottom < 64);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [inModal]);

  // 1Hz tick for the sticky-header countdown only. The main header's
  // countdown has its own 250ms interval inside SpeedAssetHeader.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Share menu — same pattern as prediction-market page.
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  // Referral codes were stripped in W3; share link is the bare market URL.
  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/speed/${id}`
    : "";

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(tMarket("linkCopied") ?? "Link copied!");
    setTimeout(() => setCopied(false), 2000);
    setShowShareMenu(false);
  };

  const handleShareWhatsApp = () => {
    if (!market) return;
    const message = `${t("upOrDown")} ${market.duration} on Bitcoin\n${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    setShowShareMenu(false);
  };

  useEffect(() => {
    if (!showShareMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showShareMenu]);

  // Auto-redirect to next market when current one resolves.
  // Tiered delay so the user gets the UX they expect:
  //   - No open position: redirect immediately (delayMs = 0). The market
  //     they were watching is irrelevant once it closes; jump them to the
  //     fresh live market without making them stare at a resolving card.
  //   - Open position: wait 10s so the speed-resolve cron (mig 362, 5s
  //     interval) has time to flip status open → resolved + credit the
  //     payout. Within those 10s the user sees Resolving → Resolved Up/
  //     Down + winnings. Then redirect.
  useEffect(() => {
    if (!market) return;
    if (redirectFiredRef.current) return;
    const expired =
      market.status !== "open" ||
      new Date(market.closes_at).getTime() <= Date.now();
    if (!expired) return;

    redirectFiredRef.current = true;
    const hasOpenPosition = position?.status === "open";
    const initialDelayMs = hasOpenPosition ? 10_000 : 0;

    let cancelled = false;
    let pollId: ReturnType<typeof setTimeout> | null = null;

    // Poll for the next live aligned market every 2s for up to 60s. The
    // speed-roll cron creates the next market at the boundary (mig 362,
    // ~5s interval), but there's a small gap between the current expiry
    // and the next status='open' flip. A single one-shot setTimeout
    // missed that window and the redirect silently never fired. Polling
    // catches the next market the moment it opens.
    async function findAndGo() {
      if (cancelled) return;
      const params = new URLSearchParams({
        asset: market!.asset,
        duration: market!.duration,
        status: "open",
        sort: "asc",
        limit: "10",
      });
      let candidates: { id: string; opens_at: string; closes_at: string }[] = [];
      try {
        const res = await fetch(`/api/speed/markets?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as {
            markets: { id: string; opens_at: string; closes_at: string }[];
          };
          candidates = json.markets ?? [];
        }
      } catch {
        // transient network error — retry on next tick
      }
      if (cancelled) return;
      const nowMs = Date.now();
      const next = candidates.find((c) => {
        if (c.id === market!.id) return false;
        const opensMs = new Date(c.opens_at).getTime();
        const closesMs = new Date(c.closes_at).getTime();
        return (
          opensMs <= nowMs &&
          closesMs > nowMs &&
          isMarketAligned(c.opens_at, market!.duration)
        );
      });
      if (next) {
        // Phase 12D: tell the next mount of the modal route to skip the
        // slide-in animation. The card stays static; only the data swaps.
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("speed-suppress-slide", "1");
          } catch {
            // ignore — private mode / quota
          }
        }
        router.replace(`/speed/${next.id}`);
      } else {
        // Try again in 2s. Cap at ~60s of retries.
        pollId = setTimeout(findAndGo, 2000);
      }
    }

    const startTimer = setTimeout(findAndGo, initialDelayMs);
    // Hard stop so we don't poll forever if the cron is broken.
    const giveUp = setTimeout(() => {
      cancelled = true;
      if (pollId) clearTimeout(pollId);
    }, initialDelayMs + 60_000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearTimeout(giveUp);
      if (pollId) clearTimeout(pollId);
    };
  }, [market, position, router]);

  // Loading: show only the chart container with its internal loader.
  // No header skeleton, no pills skeleton, no about-section skeleton — the
  // user explicitly wants component-level loading, not a whole-screen one.
  // The chart container reserves the right height so there's no layout shift
  // when the real header/pills/about appear above and below it.
  if (mLoading || oLoading) {
    return (
      <div className="pb-36 lg:pb-4">
        <div className="pt-3 pb-2 min-h-[88px]" />
        <div className="grid-dots rounded-xl border border-border-custom p-3">
          <div className="h-[520px] md:h-[320px] flex items-center justify-center">
            <div className="h-1 w-32 animate-pulse rounded-full bg-muted-custom/30" />
          </div>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-custom">Market not found.</p>
      </div>
    );
  }

  const expired = market.status !== "open" || new Date(market.closes_at).getTime() <= Date.now();
  const stickySecondsLeft = Math.max(
    0,
    Math.floor((new Date(market.closes_at).getTime() - now) / 1000),
  );
  const stickyTotalSeconds = durationToSeconds(market.duration);
  void stickyTotalSeconds;

  // Note: do NOT extract sidebar JSX into an inline component defined inside
  // SpeedMarketContent. The oracle hook ticks `now` every 1s, which re-renders
  // this component; an inline-defined component is a fresh function reference each
  // render, so React unmounts/remounts the panel and wipes local state
  // (e.g. selected side). Inline JSX keeps the panel mounted across ticks.

  const shareSlot = (
    <div ref={shareRef} className="relative">
      <button
        onClick={() => setShowShareMenu((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 transition-colors"
        aria-label="Share"
      >
        <Share2 className="w-4 h-4 text-muted-custom" />
      </button>
      {showShareMenu && (
        <div className="absolute end-0 top-10 z-50 w-48 bg-surface border border-border-custom rounded-xl shadow-xl p-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium text-text hover:bg-elevated rounded-lg transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-muted-custom" />}
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={handleShareWhatsApp}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium text-text hover:bg-elevated rounded-lg transition-colors"
          >
            <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
            WhatsApp
          </button>
        </div>
      )}
    </div>
  );

  // ── Mobile (modal) → v2 single-screen layout ──────────────────────
  // Phase 10: when rendered inside the mobile modal (`inModal`), use the
  // new Speed Round v2 design. Desktop standalone route renders the
  // original layout unchanged below.
  if (inModal) {
    return (
      <SpeedRoundV2
        market={market}
        livePrice={price}
        isStale={isStale}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="pb-36 lg:pb-4">
      <SpeedAssetHeader
        ref={titleRef}
        asset={market.asset}
        duration={market.duration}
        opensAt={market.opens_at}
        closesAt={market.closes_at}
        status={market.status}
        livePrice={price}
        strikePrice={Number(market.strike_price)}
        twap={market.twap_at_close}
        isStale={isStale}
        shareSlot={shareSlot}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* LEFT COLUMN — Chart + window pills + about */}
        <div className="space-y-4 lg:space-y-3 min-w-0">
          {/* Chart card. When the modal is closing, swap the live chart
              for a same-size empty container — pre-unmounts the
              lightweight-charts instance (its dispose is the heaviest
              single op on back-nav) so the unmount frame doesn't block
              and the slide-out stays smooth. */}
          <div className="grid-dots rounded-xl border border-border-custom p-3 relative group">
            {isClosing ? (
              <div className="!h-[520px] md:!h-[320px] w-full" aria-hidden />
            ) : (
              <SpeedPriceChart
                asset={market.asset}
                strikePrice={Number(market.strike_price)}
                opensAt={market.opens_at}
                closesAt={market.closes_at}
                duration={market.duration}
                status={market.status}
                height={320}
                chartType={chartType}
                className="!h-[520px] md:!h-[320px]"
              />
            )}
          </div>

          {/* Pills row: Past + Live on the left, chart-type toggle on the
              right. All pills share the same rounded-full shape and
              padding (px-3 py-1) so the visual rhythm is consistent. */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <SpeedWindowPills
                asset={market.asset}
                duration={market.duration}
                currentId={market.id}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-label="Candlestick view"
                aria-pressed={chartType === "candle"}
                onClick={() => handleChartTypeChange("candle")}
                className={cn(
                  "inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors shrink-0",
                  chartType === "candle"
                    ? "bg-text text-bg"
                    : "bg-surface text-muted-custom hover:text-text hover:bg-bg",
                )}
              >
                <CandlestickChart className="h-4 w-4" strokeWidth={2.25} />
              </button>
              <button
                type="button"
                aria-label="Line view"
                aria-pressed={chartType === "line"}
                onClick={() => handleChartTypeChange("line")}
                className={cn(
                  "inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors shrink-0",
                  chartType === "line"
                    ? "bg-text text-bg"
                    : "bg-surface text-muted-custom hover:text-text hover:bg-bg",
                )}
              >
                <LineChartIcon className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
          </div>

          {/* Mobile: expired view inline */}
          {expired && !position && (
            <div className="lg:hidden">
              <ExpiredView market={market} />
            </div>
          )}

          {/* Mobile: position summary inline */}
          {position && (
            <div className="lg:hidden">
              <SpeedPositionPanel
                key={`pos-${position.id}-${bumpKey}`}
                market={market}
                position={position}
                livePrice={price}
                isStale={isStale}
              />
            </div>
          )}

          <SpeedAboutMarket asset={market.asset} duration={market.duration} />
        </div>

        {/* Desktop: sticky right column */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {position ? (
              <SpeedPositionPanel
                key={`pos-${position.id}-${bumpKey}`}
                market={market}
                position={position}
                livePrice={price}
                isStale={isStale}
              />
            ) : expired ? (
              <ExpiredView market={market} />
            ) : (
              <SpeedTradePanel
                market={market}
                livePrice={price}
                isStale={isStale}
                onBetPlaced={() => setBumpKey((k) => k + 1)}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Sticky header — fixed bar on mobile when title scrolls out of view.
          Hidden when rendered inside the modal overlay (modal has its own). */}
      {!inModal && (
        <div
          className={cn(
            "fixed top-16 left-0 right-0 z-30 lg:hidden px-4 py-2.5 bg-bg/95 backdrop-blur-sm border-b border-border-custom transition-all duration-200",
            showStickyHeader
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2 pointer-events-none",
          )}
        >
          <div className="flex items-start justify-between gap-3 max-w-[1240px] mx-auto">
            <p className="text-sm font-bold font-satoshi text-text min-w-0 truncate">
              Bitcoin {t("upOrDown")} {market.duration}
            </p>
            {!expired && (
              <span className="text-lg font-black font-satoshi tabular-nums text-text whitespace-nowrap shrink-0">
                {formatSpeedCountdown(stickySecondsLeft)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Mobile-only fixed bottom trade bar */}
      <SpeedMobileTradeBar
        market={market}
        position={position}
        livePrice={price}
        isStale={isStale}
        onBetPlaced={() => setBumpKey((k) => k + 1)}
      />
    </div>
  );
}

function ExpiredView({ market }: { market: SpeedMarket }) {
  const t = useTranslations("speed");
  const isResolved = market.status === "resolved" && !!market.outcome;
  const isVoided = market.status === "voided";
  // 'halted' was a transient status in the prediction-market era; the
  // slim Sooq schema doesn't include it. Keeping the variable as `false`
  // until we drop the branch in the JSX below in a follow-up cleanup.
  const isHalted = false;

  if (isResolved) {
    const outcome = market.outcome!;
    const accent =
      outcome === "over"
        ? "text-success"
        : outcome === "under"
          ? "text-destructive"
          : "text-muted-custom";
    const outcomeKey = outcome === "at_strike" ? "atStrike" : outcome;
    const twap = market.twap_at_close
      ? `Close $${market.twap_at_close.toLocaleString()}`
      : null;

    return (
      <div className="rounded-2xl border border-border-custom bg-surface p-6 flex flex-col items-center text-center">
        <CheckCircle2 className="h-12 w-12 mb-3 text-success" />
        <div className="font-satoshi text-xl font-black">
          {t("resolved")}{" "}
          <span className={accent}>{t(outcomeKey)}</span>
        </div>
        {twap && (
          <div className="mt-2 text-xs text-muted-custom tabular-nums">
            {twap}
          </div>
        )}
      </div>
    );
  }

  if (isVoided) {
    return (
      <div className="rounded-2xl border border-border-custom bg-surface p-6 flex flex-col items-center text-center">
        <XCircle className="h-12 w-12 mb-3 text-error" />
        <div className="font-satoshi text-xl font-black text-error">
          {t("voided")}
        </div>
      </div>
    );
  }

  if (isHalted) {
    return (
      <div className="rounded-2xl border border-border-custom bg-surface p-6 flex flex-col items-center text-center">
        <MinusCircle className="h-12 w-12 mb-3 text-muted-custom" />
        <div className="font-satoshi text-xl font-black text-muted-custom">
          {t("marketClosed")}
        </div>
      </div>
    );
  }

  // Resolving (no user position): clearer copy than the old "Settling round…"
  // placeholder. With mig 362's sub-minute cron, this state lasts 0-5s.
  return (
    <div className="rounded-2xl border border-border-custom bg-surface p-6 flex flex-col items-center text-center">
      <span className="h-3 w-3 rounded-full bg-muted-custom animate-pulse mb-3" />
      <div className="font-satoshi text-xl font-black text-text">
        {t("resolving")}
      </div>
      <div className="mt-1 text-xs text-muted-custom">{t("profitsSoon")}</div>
    </div>
  );
}
