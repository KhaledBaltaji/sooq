"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSupabase } from "@/components/providers/supabase-provider";
import { cn } from "@/lib/utils";
import { isMarketAligned } from "@/lib/speed/pricing";
import type { SpeedAsset, SpeedDuration, SpeedMarketOutcome } from "@/types/database";

interface RecentRow {
  id: string;
  outcome: SpeedMarketOutcome | null;
  twap: string | null;
  resolved_at: string;
  opens_at: string;
}

/**
 * Last N resolved markets for a given (asset, duration) pair, displayed
 * below the trade panel on /speed/[id]. Educational + social proof of
 * recent volatility / outcome distribution.
 *
 * "First settlement coming up" empty state when no resolved markets exist
 * yet (per design review).
 */
export function SpeedRecentSettlements({
  asset,
  duration,
  limit = 5,
}: {
  asset: SpeedAsset;
  duration: SpeedDuration;
  limit?: number;
}) {
  const t = useTranslations("speed");
  const supabase = useSupabase();
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Pull a few extra to account for off-clock test artifacts we'll
      // filter out below — typically <5 leaks at any time, but use 3x as
      // headroom so the UI still shows `limit` real settlements.
      const { data } = await supabase
        .from("speed_markets" as never)
        .select("id, outcome, settlement_price, resolved_at, opens_at")
        .eq("asset", asset)
        .eq("duration", duration)
        .eq("status", "resolved")
        .order("resolved_at", { ascending: false })
        .limit(limit * 3);
      if (cancelled) return;
      const mapped: RecentRow[] = ((data as { id: string; outcome: SpeedMarketOutcome | null; settlement_price: string | null; resolved_at: string; opens_at: string }[] | null) ?? [])
        // Filter out off-clock test artifacts. Cron-created rows always
        // align to the duration's clean boundary; tests that bypass cron
        // produce sub-second precision.
        .filter((r) => isMarketAligned(r.opens_at, duration))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          outcome: r.outcome,
          twap: r.settlement_price,
          resolved_at: r.resolved_at,
          opens_at: r.opens_at,
        }));
      setRows(mapped);
      setLoading(false);
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [supabase, asset, duration, limit]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-surface p-3 text-center text-xs text-muted-custom">
        First settlement coming up
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <SettledRow key={r.id} row={r} />
      ))}
    </div>
  );
}

function SettledRow({ row }: { row: RecentRow }) {
  const t = useTranslations("speed");
  const twap = row.twap ? Number(row.twap) : null;
  const outcomeLabel =
    row.outcome === "over" ? t("up") : row.outcome === "under" ? t("down") : t("atStrike");
  const outcomeClass =
    row.outcome === "over"
      ? "bg-success/10 text-success ring-success/30"
      : row.outcome === "under"
        ? "bg-destructive/10 text-destructive ring-destructive/30"
        : "bg-warning/10 text-warning ring-warning/30";

  const minutesAgo = Math.max(1, Math.floor((Date.now() - new Date(row.resolved_at).getTime()) / 60_000));
  const ago = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`;

  return (
    <div className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-xs">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", outcomeClass)}>
        {outcomeLabel}
      </span>
      <span className="font-satoshi font-bold tabular-nums">
        {twap !== null ? `$${twap.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
      </span>
      <span className="text-[10px] text-muted-custom tabular-nums">{ago}</span>
    </div>
  );
}
