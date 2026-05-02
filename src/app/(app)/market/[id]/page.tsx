"use client";

import { use, useState, useCallback, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMarket } from "@/hooks/use-market";
import { useExecuteTrade } from "@/hooks/use-execute-trade";
import { usePosition } from "@/hooks/use-position";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useUser } from "@/lib/auth/hooks";
import dynamic from "next/dynamic";

const PriceChart = dynamic(() => import("@/components/market/price-chart").then(m => ({ default: m.PriceChart })), {
  ssr: false,
  loading: () => <div className="animate-shimmer h-[200px] rounded-lg" />,
});
import { CountdownTimer } from "@/components/market/countdown-timer";
import { TradePanel } from "@/components/market/trade-panel";
import { MobileTradeBar } from "@/components/market/mobile-trade-bar";
import { MobileTradeSheet } from "@/components/market/mobile-trade-sheet";
import { MyTrades } from "@/components/market/my-trades";
import { AboutMarket } from "@/components/market/about-market";
import { RelatedMarkets } from "@/components/market/related-markets";
import { MarketComments } from "@/components/market/market-comments";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Confetti } from "@/components/ui/confetti";
import { getMarketTimeState, sharesToLots, formatSharePrice, getMaxTradeUsd } from "@/lib/market-utils";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { toast } from "sonner";
import { CheckCircle2, Expand, Share2, Copy, Check, Clock, XCircle } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import Image from "next/image";
import type { Side } from "@/types/database";

const FullscreenChart = dynamic(() => import("@/components/market/fullscreen-chart").then(m => ({ default: m.FullscreenChart })), {
  ssr: false,
});
import { mapTradeError } from "@/lib/trade-utils";

export default function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const locale = useLocale();
  const t = useTranslations("market");
  const tTrade = useTranslations("trade");
  const tToast = useTranslations("toast");
  const router = useRouter();
  const isDemo = useDemoMode();
  const { market, ammState, loading } = useMarket(id);
  const { executeTrade, loading: trading } = useExecuteTrade();
  const { yesPosition, noPosition, refetch: refetchPositions } = usePosition(id);
  const { user, refetch: refetchUser, adjustBalance } = useUser();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const isTrading = trading || tradeInProgress;
  const [showConfetti, setShowConfetti] = useState(false);
  const [closeRequest, setCloseRequest] = useState<{ side: "yes" | "no"; ts: number } | null>(null);
  const [fullscreenChart, setFullscreenChart] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  // Build share link with short code + agent referral code
  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/m/${market?.short_code ?? id}${user?.referral_code ? `?ref=${user.referral_code}` : ""}`
    : "";

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("linkCopied") ?? "Link copied!");
    setTimeout(() => setCopied(false), 2000);
    setShowShareMenu(false);
  };

  const handleShareWhatsApp = () => {
    const shareDescription = t("ogDescription");
    const message = market
      ? `${locale === "ar" ? market.question_ar : market.question_en}\n${shareDescription}\n${shareUrl}`
      : shareUrl;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    setShowShareMenu(false);
  };

  // Close share menu on outside click
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

  // Show sticky header when title scrolls out of view
  useEffect(() => {
    const handleScroll = () => {
      const el = titleRef.current;
      if (!el) return;
      // Title is out of view when its bottom is above the top nav (64px)
      setShowStickyHeader(el.getBoundingClientRect().bottom < 64);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleClosePosition = useCallback((side: "yes" | "no") => {
    setCloseRequest({ side, ts: Date.now() });
  }, []);

  const handleTrade = async (side: Side, amount: number, direction: "buy" | "sell" = "buy") => {
    if (!user) {
      openLoginModal();
      return;
    }

    // Pre-trade: fresh balance check for buys. Demo reads demo_balance_usd and
    // sends broke users to /demo/settings (reset balance) instead of opening
    // the real-money deposit modal.
    if (direction === "buy") {
      const freshUser = await refetchUser();
      const u = (freshUser ?? user) as unknown as { balance_usd: number; demo_balance_usd?: number | null };
      const currentBalance = isDemo ? Number(u.demo_balance_usd ?? 0) : u.balance_usd;
      if (currentBalance <= 0 || currentBalance < amount) {
        if (isDemo) {
          toast.error(tTrade("insufficientBalance") ?? "Not enough demo balance", {
            description: "Reset your demo balance to $10K in Settings.",
          });
        } else {
          openDepositModal();
        }
        return;
      }
    }

    setTradeInProgress(true);
    try {
      const { data: result, error: tradeErr } = await executeTrade(id, side, direction, amount);
      if (result) {
        if (direction === "buy") adjustBalance(-amount);
        // Refetch both position and balance before re-enabling button
        await Promise.all([refetchUser(), refetchPositions()]);
        setShowConfetti(true);
        setCloseRequest(null);
        toast.success(direction === "buy" ? tToast("tradePlaced") : tToast("positionClosed"), {
          description: direction === "buy"
            ? t("tradePlacedDesc", { shares: sharesToLots(result.shares).toFixed(3), side: side.toUpperCase() })
            : t("positionClosedDesc", { shares: sharesToLots(result.shares).toFixed(3), side: side.toUpperCase() }),
        });
        if (result.price_impact_warning) {
          toast.warning(tToast("largePriceImpact"), {
            description: t("largePriceImpactDesc"),
          });
        }
      } else if (tradeErr) {
        toast.error(tToast("tradeFailed"), { description: mapTradeError(tradeErr, tTrade, getMaxTradeUsd(ammState)) });
      }
    } finally {
      setTradeInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-64" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-custom">{t("marketNotFound")}</p>
      </div>
    );
  }

  const question = locale === "ar" ? market.question_ar : market.question_en;
  const description = locale === "ar" ? market.description_ar : market.description_en;
  const timeState = getMarketTimeState(market);
  const hasExpired = new Date(market.closes_at).getTime() < Date.now();
  const isOpen = (timeState === "open" || timeState === "closing_soon") && !hasExpired;
  const isUpcoming = timeState === "upcoming";
  const category = market.category?.toUpperCase() || "GENERAL";

  return (
    <div className="pb-36 lg:pb-4">
      <Confetti trigger={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Compact Header */}
      <div className="pt-3 pb-2">
        {/* Question + Inline Probability */}
        <div ref={titleRef} className="flex items-baseline justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {market.image_url && (
              <Image
                src={market.image_url}
                alt=""
                width={40}
                height={40}
                className="rounded-lg object-cover shrink-0 hidden lg:block mt-0.5"
              />
            )}
            <h1 className="text-xl lg:text-2xl font-black font-satoshi tracking-tight leading-tight text-text">
              {question}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ammState && !isUpcoming && (
              <span className="text-2xl lg:text-3xl font-black font-satoshi tabular-nums text-yes whitespace-nowrap">
                {formatSharePrice(ammState.current_yes_price)}
              </span>
            )}
            {/* Share button */}
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
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-2 lg:gap-3 mt-1.5 text-[11px] text-muted-custom">
          <span className="hidden lg:inline px-2 py-0.5 rounded-md bg-white/10 border border-white/20 text-text font-bold tracking-wide uppercase shrink-0">
            {category}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-success" : isUpcoming ? "bg-warning" : "bg-no"}`} />
            <span className={`font-bold uppercase tracking-wider ${isOpen ? "text-success" : isUpcoming ? "text-warning" : "text-no"}`}>
              {isUpcoming
                ? t("statusUpcoming")
                : hasExpired
                ? t("statusEnded")
                : market.status === "open"
                ? t("statusActive")
                : market.status}
            </span>
          </div>
          {isUpcoming && (
            <div className="flex items-center gap-1 shrink-0 text-warning">
              <span>{t("opensIn")}</span>
              <CountdownTimer endsAt={market.opens_at} variant="upcoming" className="shrink-0" />
            </div>
          )}
          {isOpen && !hasExpired && (
            <CountdownTimer endsAt={market.closes_at} className="shrink-0" />
          )}
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* LEFT COLUMN — Main content */}
        <div className="space-y-4 lg:space-y-3 min-w-0">
          {/* Price Chart */}
          <div className="grid-dots rounded-xl border border-border-custom p-3 relative group">
            {isUpcoming ? (
              <div className="h-[280px] xl:h-[320px] flex flex-col items-center justify-center text-center px-6">
                <Clock className="w-10 h-10 text-warning mb-3" />
                <span className="text-lg font-bold font-satoshi text-text">{t("marketNotLiveYet")}</span>
                <div className="mt-2 flex items-center gap-1.5 text-muted-custom">
                  <span className="text-sm">{t("opensIn")}</span>
                  <CountdownTimer
                    endsAt={market.opens_at}
                    variant="upcoming"
                    className="text-xl font-black font-satoshi text-warning tabular-nums"
                  />
                </div>
              </div>
            ) : (
              <>
                <PriceChart marketId={id} createdAt={market.created_at} ammState={ammState} chartHeight="h-[280px] xl:h-[320px]" />
                {/* Expand button — mobile only */}
                <button
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); setFullscreenChart(true); }}
                  className="lg:hidden absolute top-3 end-3 z-10 w-9 h-9 flex items-center justify-center rounded-lg bg-surface/80 backdrop-blur-sm border border-border-custom transition-opacity"
                  aria-label={t("expandChart")}
                >
                  <Expand className="w-4 h-4 text-muted-custom" />
                </button>
              </>
            )}
          </div>

          {/* My Trades */}
          <MyTrades
            marketId={id}
            market={market}
            ammState={ammState}
            yesPosition={yesPosition}
            noPosition={noPosition}
            onClosePosition={handleClosePosition}
          />

          {/* About this Market */}
          <AboutMarket description={description} />

          {/* Comments */}
          <MarketComments marketId={id} />
        </div>

        {/* RIGHT COLUMN — Sidebar (desktop only) */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {/* Trade Panel */}
            {ammState ? (
              <div className="relative">
                {!isOpen && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg px-6 text-center">
                    {isUpcoming ? (
                      <>
                        <Clock className="w-12 h-12 text-warning mb-2" />
                        <span className="text-lg font-bold font-satoshi text-white">{t("marketOpensIn")}</span>
                        <CountdownTimer
                          endsAt={market.opens_at}
                          variant="upcoming"
                          className="mt-1 text-2xl font-black font-satoshi text-white tabular-nums"
                        />
                        <span className="text-xs text-white/70 mt-2">{t("tradingLocked")}</span>
                      </>
                    ) : market.status === "resolved" ? (
                      <>
                        <CheckCircle2 className="w-12 h-12 text-success mb-2" />
                        <span className="text-lg font-bold font-satoshi text-white">
                          {market.outcome === "yes"
                            ? t("resolvedYes")
                            : market.outcome === "no"
                            ? t("resolvedNo")
                            : t("resolved")}
                        </span>
                      </>
                    ) : market.status === "voided" ? (
                      <>
                        <XCircle className="w-12 h-12 text-error mb-2" />
                        <span className="text-lg font-bold font-satoshi text-white">{t("voided")}</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-12 h-12 text-muted-custom mb-2" />
                        <span className="text-lg font-bold font-satoshi text-white">{t("marketClosed")}</span>
                      </>
                    )}
                  </div>
                )}
                <div className={!isOpen ? "pointer-events-none" : ""}>
                  <TradePanel
                    market={market}
                    ammState={ammState}
                    position={{ yes: yesPosition, no: noPosition }}
                    onConfirm={handleTrade}
                    loading={isTrading}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-lg p-5 border border-border-custom space-y-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
              </div>
            )}

            {/* Related Markets */}
            <RelatedMarkets
              currentMarketId={id}
              category={market.category || "general"}
            />
          </div>
        </aside>
      </div>

      {/* Sticky header — fixed bar when title scrolls out of view (mobile only) */}
      {ammState && (
        <div
          className={`fixed top-16 left-0 right-0 z-30 lg:hidden px-4 py-2.5 bg-bg/95 backdrop-blur-sm border-b border-border-custom transition-all duration-200 ${
            showStickyHeader
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2 pointer-events-none"
          }`}
        >
          <div className="flex items-start justify-between gap-3 max-w-[1240px] mx-auto">
            <p className="text-sm font-bold font-satoshi text-text min-w-0">
              {question}
            </p>
            {!isUpcoming && (
              <span className="text-lg font-black font-satoshi tabular-nums text-yes whitespace-nowrap shrink-0">
                {formatSharePrice(ammState.current_yes_price)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Mobile trade bar — fixed Buy Yes / Buy No buttons */}
      {ammState && isOpen && (
        <MobileTradeBar
          market={market}
          ammState={ammState}
          position={{ yes: yesPosition, no: noPosition }}
          onConfirm={handleTrade}
          loading={isTrading}
        />
      )}

      {/* Close position sheet — unified for desktop & mobile */}
      {ammState && (
        <Sheet open={closeRequest !== null} onOpenChange={(open) => !open && setCloseRequest(null)}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl max-w-[480px] mx-auto"
            showCloseButton={false}
          >
            <MobileTradeSheet
              market={market}
              ammState={ammState}
              position={{ yes: yesPosition, no: noPosition }}
              onConfirm={handleTrade}
              loading={isTrading}
              closeRequest={closeRequest}
              onClose={() => setCloseRequest(null)}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Fullscreen chart overlay — mobile */}
      {ammState && (
        <FullscreenChart
          open={fullscreenChart}
          onClose={() => setFullscreenChart(false)}
          market={market}
          ammState={ammState}
          position={{ yes: yesPosition, no: noPosition }}
          onTradeComplete={() => { refetchPositions(); refetchUser(); }}
        />
      )}
    </div>
  );
}
