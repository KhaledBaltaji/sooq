"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowLeftRight, Wallet, Coins, History } from "lucide-react";

import { useMergedPositions } from "@/hooks/use-merged-positions";
import { useUser } from "@/lib/auth/hooks";
import { useExecuteTrade } from "@/hooks/use-execute-trade";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { formatCurrency, cn } from "@/lib/utils";
import { sharesToLots } from "@/lib/market-utils";

import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MobileTradeSheet } from "@/components/market/mobile-trade-sheet";
import { PnlPill } from "@/components/trade/pnl-pill";
import { PositionCard } from "@/components/trade/position-card";
import { SpeedPositionRow } from "@/components/speed/speed-position-row";
import {
  PositionSortChips,
  type PositionFilter,
} from "@/components/trade/position-sort-chips";
import { TradeEmptyState } from "@/components/trade/trade-empty-state";

import { toast } from "sonner";
import type { Side } from "@/types/database";
import type { PositionWithMarket } from "@/types/market";
import type { UnifiedPosition } from "@/types/position";

/**
 * Trade screen — portfolio + positions list.
 *
 * Post-upgrade (2026-04-23):
 *   1. Site footer hidden on mobile via FooterGate in (app)/layout.tsx
 *   2. Position question wraps to 2 lines, no truncation by default
 *   3. Position rows are rounded-2xl cards with breathing room
 *   4. Typography bumped across the entire page
 *   + Tier-B polish: P/L pill, sort chips (≥3 positions), sparkline per card,
 *     neutral $0 P/L rendering, empty-state hero + "Trending now" picks.
 */
export default function TradePage() {
  const locale = useLocale();
  const isDemo = useDemoMode();
  const { user, loading: userLoading, refetch: refetchUser } = useUser();
  const { positions: mergedPositions, stats, loading: posLoading, refetch } = useMergedPositions();
  const { executeTrade, loading: isTrading } = useExecuteTrade();
  const { price: btcPrice, isStale: btcStale } = useSpeedOracleLatest("BTC");
  const { openLoginModal } = useAuthModal();

  const [filter, setFilter] = useState<PositionFilter>("all");
  const [tradeTarget, setTradeTarget] = useState<PositionWithMarket | null>(null);
  const [closeRequest, setCloseRequest] = useState<{ side: Side; ts: number } | null>(null);

  const loading = userLoading || posLoading;

  const balance = isDemo
    ? Number((user as unknown as { demo_balance_usd?: number | null })?.demo_balance_usd ?? 0)
    : user?.balance_usd ?? 0;

  const equity = balance + stats.openMarketValue;
  const totalPnl = stats.unrealizedPnl + stats.realizedPnl;
  const totalPnlPct = balance > 0 ? (totalPnl / (balance + stats.openCostBasis || 1)) * 100 : 0;

  // Filter logic spans both kinds — speed positions use their fair-value-based pnl,
  // prediction positions use AMM-based pnl. Both already computed in
  // useMergedPositions so we just consume.
  const filteredPositions = useMemo(() => {
    switch (filter) {
      case "gainers":
        return mergedPositions.filter((u) => u.pnl > 0);
      case "losers":
        return mergedPositions.filter((u) => u.pnl < 0);
      case "closing":
        // "Closing soon" = soonest expiry first. Speed markets always have a
        // closes_at; prediction markets do too. Take the 5 nearest deadlines.
        return [...mergedPositions]
          .map((u) => ({
            u,
            closesAt:
              u.kind === "speed"
                ? u.position.market?.closes_at
                : u.position.market?.closes_at,
          }))
          .filter((x) => x.closesAt)
          .sort((a, b) =>
            new Date(a.closesAt!).getTime() - new Date(b.closesAt!).getTime(),
          )
          .slice(0, 5)
          .map((x) => x.u);
      default:
        return mergedPositions;
    }
  }, [mergedPositions, filter]);

  const chips = useMemo(() => {
    let gainers = 0;
    let losers = 0;
    for (const u of mergedPositions) {
      if (u.pnl > 0) gainers++;
      else if (u.pnl < 0) losers++;
    }
    return [
      { id: "all" as const, label: "All", count: mergedPositions.length },
      { id: "gainers" as const, label: "Gainers", count: gainers },
      { id: "losers" as const, label: "Losers", count: losers },
      { id: "closing" as const, label: "Closing soon", count: null },
    ];
  }, [mergedPositions]);

  const handleTrade = async (side: Side, amount: number, direction: "buy" | "sell") => {
    if (!tradeTarget) return;
    try {
      const { data: result, error: tradeErr } = await executeTrade(
        tradeTarget.market_id,
        side,
        direction,
        amount
      );
      if (result) {
        await Promise.all([refetchUser(), refetch()]);
        setTradeTarget(null);
        setCloseRequest(null);
        const lots = sharesToLots(result.shares).toFixed(3);
        toast.success(direction === "buy" ? "Trade placed" : "Position closed", {
          description: `${lots} ${side.toUpperCase()} lots`,
        });
      } else if (tradeErr) {
        toast.error("Trade failed", { description: String(tradeErr) });
      }
    } catch {
      toast.error("Trade failed");
    }
  };

  const openCloseSheet = (pos: PositionWithMarket) => {
    setTradeTarget(pos);
    setCloseRequest({ side: pos.side as Side, ts: Date.now() });
  };

  // ---- Loading ----
  if (loading) {
    return (
      <div className="pt-6 pb-24 px-5 space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-6 w-24 mt-4" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  // ---- Anonymous ----
  if (!user) {
    return (
      <div className="pt-16 pb-24 px-6 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-full bg-elevated flex items-center justify-center mb-5">
          <ArrowLeftRight className="w-6 h-6 text-muted-custom" />
        </div>
        <h2 className="text-lg font-satoshi font-bold text-text mb-2">Sign up to trade</h2>
        <p className="text-sm text-muted-custom font-dm-sans leading-relaxed mb-8">
          Create an account to place trades, track positions, and cash out anytime. Browsing
          markets is free — no account needed.
        </p>
        <div className="w-full space-y-3">
          <button
            type="button"
            onClick={openLoginModal}
            className="w-full h-12 rounded-md bg-yes text-white text-sm font-satoshi font-bold cursor-pointer hover:brightness-110 transition-all"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={openLoginModal}
            className="w-full h-12 rounded-md bg-surface border border-border-custom text-text text-sm font-satoshi font-bold cursor-pointer hover:bg-elevated transition-colors"
          >
            Create account
          </button>
          <Link
            href="/"
            className="block w-full h-12 flex items-center justify-center rounded-md text-sm font-satoshi font-bold text-muted-custom hover:text-text transition-colors"
          >
            Browse markets
          </Link>
        </div>
      </div>
    );
  }

  // ---- Main ----
  return (
    <PullToRefresh onRefresh={refetch}>
      <div className="pt-6 pb-24">
        {/* HERO */}
        <div className="px-[18px] pb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-muted-custom font-dm-sans font-medium">
              Total portfolio
            </span>
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-sm text-muted-custom hover:text-text transition-colors font-dm-sans font-medium"
            >
              <History className="w-4 h-4" /> History
            </Link>
          </div>
          <h1 className="font-satoshi font-black text-[44px] leading-none tabular-nums -tracking-[0.025em] text-text">
            {formatCurrency(equity)}
          </h1>
          <div className="mt-3">
            <PnlPill pnl={totalPnl} pnlPct={totalPnlPct} label="All Time" />
          </div>
        </div>

        {/* Stats row — Cash / Invested */}
        <div className="px-[18px] pb-[18px] grid grid-cols-2 gap-2.5">
          <StatCard label="Cash" value={balance} icon={Wallet} />
          <StatCard label="Invested" value={stats.openCostBasis} icon={Coins} />
        </div>

        {/* Positions section — unified prediction + speed list */}
        <div className="px-[18px] pb-2.5 flex justify-between items-center">
          <h2 className="font-satoshi font-bold text-[18px] text-text">Positions</h2>
          <span className="text-sm text-muted-custom">{mergedPositions.length} open</span>
        </div>

        {/* Sort chips — only if ≥3 positions */}
        {mergedPositions.length >= 3 && (
          <div className="px-[18px] pb-3">
            <PositionSortChips chips={chips} active={filter} onChange={setFilter} />
          </div>
        )}

        {/* Position list — switch on kind to render correct card */}
        {mergedPositions.length === 0 ? (
          <div className="px-[14px] pb-6">
            <TradeEmptyState isDemo={isDemo} locale={locale} />
          </div>
        ) : filteredPositions.length === 0 ? (
          <div className="px-[14px] pb-6">
            <div className="rounded-2xl bg-surface border border-border-custom px-5 py-7 text-center">
              <p className="text-sm text-muted-custom">No positions match this filter.</p>
            </div>
          </div>
        ) : (
          <div className="px-[14px] pb-6 flex flex-col gap-2.5">
            {filteredPositions.map((u: UnifiedPosition) =>
              u.kind === "prediction" ? (
                <PositionCard
                  key={`pred-${u.position.market_id}-${u.position.side}`}
                  position={u.position}
                  locale={locale}
                  onTap={() => openCloseSheet(u.position)}
                />
              ) : (
                <SpeedPositionRow
                  key={`speed-${u.position.id}`}
                  pos={u.position}
                  livePrice={btcPrice}
                  isStale={btcStale}
                />
              ),
            )}
          </div>
        )}

        {/* Close-position sheet */}
        {tradeTarget?.market && tradeTarget?.amm_state && (
          <Sheet
            open={tradeTarget !== null}
            onOpenChange={(open) => {
              if (!open) {
                setTradeTarget(null);
                setCloseRequest(null);
              }
            }}
          >
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] overflow-y-auto rounded-t-2xl max-w-[480px] mx-auto"
              showCloseButton={false}
            >
              <MobileTradeSheet
                market={tradeTarget.market}
                ammState={tradeTarget.amm_state}
                position={{
                  yes:
                    mergedPositions.find(
                      (u) =>
                        u.kind === "prediction" &&
                        u.position.market_id === tradeTarget.market_id &&
                        u.position.side === "yes",
                    )?.position as PositionWithMarket | undefined ?? null,
                  no:
                    mergedPositions.find(
                      (u) =>
                        u.kind === "prediction" &&
                        u.position.market_id === tradeTarget.market_id &&
                        u.position.side === "no",
                    )?.position as PositionWithMarket | undefined ?? null,
                }}
                onConfirm={handleTrade}
                loading={isTrading}
                closeRequest={closeRequest}
                onClose={() => {
                  setTradeTarget(null);
                  setCloseRequest(null);
                }}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </PullToRefresh>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Wallet;
}) {
  return (
    <div className="rounded-xl bg-surface border border-border-custom p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-muted-custom font-dm-sans font-medium">
        <Icon className="w-[13px] h-[13px]" /> {label}
      </div>
      <div
        className={cn(
          "font-satoshi font-black text-[22px] tabular-nums mt-1 -tracking-[0.01em] text-text"
        )}
      >
        {formatCurrency(value)}
      </div>
    </div>
  );
}
