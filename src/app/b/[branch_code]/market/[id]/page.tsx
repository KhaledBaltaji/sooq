"use client";

import { use, useState, useCallback, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMarket } from "@/hooks/use-market";
import { useBranchTrade } from "@/hooks/use-branch-trade";
import { useBranchContext } from "@/components/providers/branch-provider";
import { usePosition } from "@/hooks/use-position";
import { useUser } from "@/lib/auth/hooks";
import dynamic from "next/dynamic";

const PriceChart = dynamic(
  () => import("@/components/market/price-chart").then((m) => ({ default: m.PriceChart })),
  { ssr: false, loading: () => <div className="animate-shimmer h-[200px] rounded-lg" /> }
);
import { CountdownTimer } from "@/components/market/countdown-timer";
import { TradePanel } from "@/components/market/trade-panel";
import { MobileTradeBar } from "@/components/market/mobile-trade-bar";
import { MobileTradeSheet } from "@/components/market/mobile-trade-sheet";
import { MyTrades } from "@/components/market/my-trades";
import { AboutMarket } from "@/components/market/about-market";
import { MarketComments } from "@/components/market/market-comments";
import { RelatedMarkets } from "@/components/market/related-markets";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Confetti } from "@/components/ui/confetti";
import { getMarketTimeState, sharesToLots, formatSharePrice, getMaxTradeUsd } from "@/lib/market-utils";
import { formatBranchPrice, applyMarkup, toDecimalOdds, formatDecimalOdds } from "@/lib/branch-pricing";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { toast } from "sonner";
import { CheckCircle2, Expand, Share2, Copy, Check, Clock, XCircle } from "lucide-react";
import Image from "next/image";
import type { Side } from "@/types/database";

const FullscreenChart = dynamic(
  () => import("@/components/market/fullscreen-chart").then((m) => ({ default: m.FullscreenChart })),
  { ssr: false }
);
import { mapTradeError } from "@/lib/trade-utils";

export default function BranchMarketDetailPage({
  params,
}: {
  params: Promise<{ branch_code: string; id: string }>;
}) {
  const { id, branch_code } = use(params);
  const branchCtx = useBranchContext();
  const branch = branchCtx?.branch;
  const locale = useLocale();
  const t = useTranslations("market");
  const tTrade = useTranslations("trade");
  const tToast = useTranslations("toast");
  const { market, ammState, loading } = useMarket(id);
  const { executeBranchTrade, loading: trading } = useBranchTrade();
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

  const displayMode = branch?.display_mode ?? "trading";

  // Share link using branch route
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/b/${branch_code}/market/${id}`
      : "";

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("linkCopied") ?? "Link copied!");
    setTimeout(() => setCopied(false), 2000);
    setShowShareMenu(false);
  };

  const handleShareWhatsApp = () => {
    const message = market
      ? `${locale === "ar" ? market.question_ar : market.question_en}\n${shareUrl}`
      : shareUrl;
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

  useEffect(() => {
    const handleScroll = () => {
      const el = titleRef.current;
      if (!el) return;
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

    if (direction === "buy") {
      const freshUser = await refetchUser();
      const currentBalance = freshUser?.balance_usd ?? user.balance_usd;
      if (currentBalance <= 0 || currentBalance < amount) {
        openDepositModal();
        return;
      }
    }

    setTradeInProgress(true);
    try {
      const { data: result, error: tradeErr } = await executeBranchTrade(id, side, direction, amount);
      if (result) {
        if (direction === "buy") adjustBalance(-amount);
        await Promise.all([refetchUser(), refetchPositions()]);
        setShowConfetti(true);
        setCloseRequest(null);
        toast.success(direction === "buy" ? tToast("tradePlaced") : tToast("positionClosed"), {
          description:
            direction === "buy"
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

  // Branch markup props for TradePanel
  const branchMarkup = branch
    ? { yesPct: branch.yes_markup_pct, noPct: branch.no_markup_pct }
    : undefined;
  const branchExitFee = branch?.exit_fee_pct;

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

  // Branch-adjusted price display
  const yesMarkupPct = branch?.yes_markup_pct ?? 0;
  const noMarkupPct = branch?.no_markup_pct ?? 0;
  const headerPrice = ammState
    ? displayMode === "betting"
      ? formatDecimalOdds(toDecimalOdds(applyMarkup(ammState.current_yes_price, yesMarkupPct)))
      : formatSharePrice(applyMarkup(ammState.current_yes_price, yesMarkupPct))
    : "";

  return (
    <div className="pb-36 lg:pb-4">
      <Confetti trigger={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Compact Header */}
      <div className="pt-3 pb-2">
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
                {headerPrice}
              </span>
            )}
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
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#25D366]">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
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
          {isOpen && !hasExpired && <CountdownTimer endsAt={market.closes_at} className="shrink-0" />}
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-4 lg:space-y-3 min-w-0">
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
                <PriceChart
                  marketId={id}
                  createdAt={market.created_at}
                  ammState={ammState}
                  chartHeight="h-[280px] xl:h-[320px]"
                  yesMarkupPct={branch?.yes_markup_pct ?? 0}
                  noMarkupPct={branch?.no_markup_pct ?? 0}
                />
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

          <MyTrades
            marketId={id}
            market={market}
            ammState={ammState}
            yesPosition={yesPosition}
            noPosition={noPosition}
            onClosePosition={handleClosePosition}
          />
          <AboutMarket description={description} />

          {/* Comments */}
          <MarketComments marketId={id} />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
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
                    branchMarkup={branchMarkup}
                    branchExitFee={branchExitFee}
                    displayMode={displayMode}
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

            <RelatedMarkets currentMarketId={id} category={market.category || "general"} />
          </div>
        </aside>
      </div>

      {/* Sticky header */}
      {ammState && (
        <div
          className={`fixed top-16 left-0 right-0 z-30 lg:hidden px-4 py-2.5 bg-bg/95 backdrop-blur-sm border-b border-border-custom transition-all duration-200 ${
            showStickyHeader ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
          }`}
        >
          <div className="flex items-start justify-between gap-3 max-w-[1240px] mx-auto">
            <p className="text-sm font-bold font-satoshi text-text min-w-0">{question}</p>
            {!isUpcoming && (
              <span className="text-lg font-black font-satoshi tabular-nums text-yes whitespace-nowrap shrink-0">
                {headerPrice}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Mobile trade bar */}
      {ammState && isOpen && (
        <MobileTradeBar
          market={market}
          ammState={ammState}
          position={{ yes: yesPosition, no: noPosition }}
          onConfirm={handleTrade}
          loading={isTrading}
          branchMarkup={branchMarkup}
          displayMode={displayMode}
        />
      )}

      {/* Close position sheet */}
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
              branchMarkup={branchMarkup}
              displayMode={displayMode}
            />
          </SheetContent>
        </Sheet>
      )}

      {ammState && (
        <FullscreenChart
          open={fullscreenChart}
          onClose={() => setFullscreenChart(false)}
          market={market}
          ammState={ammState}
          position={{ yes: yesPosition, no: noPosition }}
          onTradeComplete={() => { refetchPositions(); refetchUser(); }}
          yesMarkupPct={branch?.yes_markup_pct ?? 0}
          noMarkupPct={branch?.no_markup_pct ?? 0}
        />
      )}
    </div>
  );
}
