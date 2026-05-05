"use client";

// Live trade tape for the home page. Polls public /api/speed/recent-trades
// every ~2.5s. Anonymized handles only — see mig 0023.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  useRecentSpeedTrades,
  type RecentSpeedTrade,
} from "@/hooks/use-recent-speed-trades";

function relativeTime(iso: string, now: number) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  if (diff < 5_000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h`;
}

export function LiveTradeTape() {
  const { trades, loading } = useRecentSpeedTrades({ limit: 8 });
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-success shadow-[0_0_8px_rgba(0,232,123,0.7)]" />
        <span className="font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom">
          Live trade tape
        </span>
      </div>
      <div>
        {loading && trades.length === 0 ? (
          <GhostState />
        ) : trades.length === 0 ? (
          <EmptyState />
        ) : (
          trades.map((t) => <TradeRow key={t.trade_id} trade={t} now={now} />)
        )}
      </div>
    </section>
  );
}

function TradeRow({ trade, now }: { trade: RecentSpeedTrade; now: number }) {
  const isOver = trade.side === "over";
  const market = `${trade.asset} ${trade.duration}`;
  return (
    <div className="flex items-center gap-3.5 border-b border-border-custom py-2.5 text-sm animate-in fade-in slide-in-from-top-1 duration-300">
      <span
        className={cn(
          "h-1.5 w-1.5 flex-shrink-0 rounded-full",
          isOver ? "bg-success" : "bg-destructive",
        )}
      />
      <span className="min-w-[88px] font-dm-sans font-medium text-text">
        {trade.who_handle}
      </span>
      <span
        className={cn(
          "font-satoshi text-[11px] font-bold tracking-[0.16em]",
          isOver ? "text-success" : "text-destructive",
        )}
      >
        {isOver ? "UP" : "DOWN"}
      </span>
      <span className="font-satoshi font-bold tabular-nums text-text">
        ${trade.stake_usd.toLocaleString()}
      </span>
      <span className="ml-auto font-dm-sans text-xs text-muted-custom">
        {market}
      </span>
      <span className="font-satoshi text-[11px] font-bold tabular-nums text-muted-custom min-w-[28px] text-right">
        {relativeTime(trade.created_at, now)}
      </span>
    </div>
  );
}

function GhostState() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 border-b border-border-custom py-2.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-elevated" />
          <span className="h-3 w-20 animate-pulse rounded bg-elevated" />
          <span className="h-3 w-8 animate-pulse rounded bg-elevated" />
          <span className="h-3 w-12 animate-pulse rounded bg-elevated" />
          <span className="ml-auto h-3 w-14 animate-pulse rounded bg-elevated" />
        </div>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border-custom px-4 py-6 text-center font-dm-sans text-xs text-muted-custom">
      Trades will appear here as soon as the round opens up.
    </div>
  );
}
