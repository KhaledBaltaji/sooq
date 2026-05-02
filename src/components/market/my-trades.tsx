"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import type { Market, AmmState, Position, Trade } from "@/types/market";
import { cn, formatCurrency, formatNumber, timeAgo, triggerHapticConfirm } from "@/lib/utils";
import { formatLots, formatPrice } from "@/lib/market-utils";
import { MIN_DISPLAY_SHARES } from "@/lib/constants";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MyTradesProps {
  marketId: string;
  market: Market;
  ammState: AmmState | null;
  yesPosition: Position | null;
  noPosition: Position | null;
  onClosePosition?: (side: "yes" | "no") => void;
}


function PositionRow({
  position,
  ammState,
  onClose,
}: {
  position: Position;
  ammState: AmmState;
  onClose?: () => void;
}) {
  const t = useTranslations("market");
  const tc = useTranslations("common");
  const currentPrice = position.side === "yes"
    ? ammState.current_yes_price
    : ammState.current_no_price;
  const currentValue = position.shares_held * currentPrice;
  const costBasis = position.shares_held * position.avg_entry_price;
  const returnAmount = currentValue - costBasis;
  const returnPct = costBasis > 0 ? (returnAmount / costBasis) * 100 : 0;
  const isProfit = returnAmount >= 0;

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Left: position info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(
            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0",
            position.side === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
          )}>
            {position.side}
          </span>
          <span className="text-sm text-text font-medium tabular-nums">
            {formatLots(position.shares_held)} {t("lots")}
          </span>
          <span className="text-[11px] text-dim">
            @ {formatPrice(position.avg_entry_price, "neutral")}
          </span>
        </div>
        <div className={cn(
          "flex items-center gap-1 text-[12px] font-medium",
          isProfit ? "text-success" : "text-no"
        )}>
          {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span className="tabular-nums">
            {isProfit ? "+" : ""}{returnAmount >= 0 ? "$" : "-$"}{formatNumber(Math.abs(returnAmount))}
            {" "}({isProfit ? "+" : ""}{returnPct.toFixed(1)}%)
          </span>
          <span className="text-dim ms-1">·</span>
          <span className="text-dim tabular-nums">{formatCurrency(currentValue)}</span>
        </div>
      </div>

      {/* Right: close button */}
      {onClose && (
        <button
          onClick={() => { triggerHapticConfirm(); onClose?.(); }}
          className="shrink-0 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider rounded-md border border-border-custom bg-bg hover:bg-elevated text-muted-custom hover:text-text transition-colors cursor-pointer"
        >
          {tc("close")}
        </button>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const t = useTranslations("market");
  const isBuy = trade.direction === "buy";
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <span className={cn(
          "w-1.5 h-1.5 rounded-full",
          trade.side === "yes" ? "bg-yes" : "bg-no"
        )} />
        <span className="text-[12px] text-muted-custom">
          {isBuy ? t("bought") : t("closed")} {trade.side.toUpperCase()}
        </span>
        <span className="text-[12px] text-dim">@ {formatPrice(trade.price_per_share, "neutral")}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-text font-medium tabular-nums">
          {formatCurrency(Math.abs(trade.total_cost))}
        </span>
        <span className="text-[11px] text-dim tabular-nums min-w-[48px] text-right">
          {timeAgo(trade.created_at)}
        </span>
      </div>
    </div>
  );
}

export function MyTrades({ marketId, market, ammState, yesPosition, noPosition, onClosePosition }: MyTradesProps) {
  const { user } = useUser();
  const supabase = useSupabase();
  const t = useTranslations();
  const [showHistory, setShowHistory] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);

  const hasYes = yesPosition && yesPosition.shares_held >= MIN_DISPLAY_SHARES;
  const hasNo = noPosition && noPosition.shares_held >= MIN_DISPLAY_SHARES;
  const hasPositions = hasYes || hasNo;

  // Fetch trade history when expanded
  useEffect(() => {
    if (!showHistory || !user) return;
    setLoadingTrades(true);
    supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .eq("market_id", marketId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setTrades(data as Trade[]);
        setLoadingTrades(false);
      });
  }, [showHistory, user, marketId, supabase]);

  // Don't show if not logged in
  if (!user) return null;

  return (
    <div className="bg-surface rounded-lg border border-border-custom/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-border-custom">
        <h3 className="font-satoshi font-medium text-lg text-text">{t("market.myTrades")}</h3>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[12px] text-yes hover:text-yes/80 font-medium cursor-pointer transition-colors"
        >
          {showHistory ? t("market.hideHistory") : t("market.showHistory")}
        </button>
      </div>

      <div className="p-5">
        {/* Live Positions */}
        {hasPositions && ammState ? (
          <div className="space-y-0 divide-y divide-border-custom/50">
            {hasYes && (
              <PositionRow
                position={yesPosition!}
                ammState={ammState}
                onClose={onClosePosition ? () => onClosePosition("yes") : undefined}
              />
            )}
            {hasNo && (
              <PositionRow
                position={noPosition!}
                ammState={ammState}
                onClose={onClosePosition ? () => onClosePosition("no") : undefined}
              />
            )}
          </div>
        ) : !showHistory ? (
          <p className="text-sm text-dim text-center py-4">{t("market.noOpenPositions")}</p>
        ) : null}

        {/* Trade History (expanded) */}
        {showHistory && (
          <div className={cn(hasPositions && "mt-4 pt-4 border-t border-border-custom")}>
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-custom mb-2">
              {t("market.history")}
            </h4>
            {loadingTrades ? (
              <p className="text-sm text-dim text-center py-4">{t("common.loading")}</p>
            ) : trades.length > 0 ? (
              <div className="divide-y divide-border-custom/30">
                {trades.map((trade) => (
                  <TradeRow key={trade.id} trade={trade} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-dim text-center py-4">{t("market.noTradesYet")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
