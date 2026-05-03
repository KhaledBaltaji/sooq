"use client";

// W7 cutover: TanStack Query polling against /api/speed/markets?status=resolved.
// settlement_price is renamed to twap_at_close in the slim Sooq schema.

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { isMarketAligned } from "@/lib/speed/pricing";
import type {
  SpeedAsset,
  SpeedDuration,
  SpeedMarket,
  SpeedMarketOutcome,
} from "@/types/database";

interface RecentRow {
  id: string;
  outcome: SpeedMarketOutcome | null;
  twap: number | null;
  resolved_at: string;
  opens_at: string;
}

interface ListResponse {
  markets: SpeedMarket[];
}

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

  // Pull 3x the requested limit so we still have `limit` rows after
  // filtering off-clock test artifacts.
  const fetchLimit = Math.max(15, limit * 3);

  const query = useQuery<ListResponse>({
    queryKey: ["speed-recent-settlements", asset, duration, fetchLimit],
    queryFn: async () => {
      const params = new URLSearchParams({
        asset,
        status: "resolved",
        limit: String(fetchLimit),
      });
      const res = await fetch(`/api/speed/markets?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load settlements (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const rows: RecentRow[] = (query.data?.markets ?? [])
    .filter((m) => m.duration === duration && isMarketAligned(m.opens_at, duration))
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      outcome: m.outcome,
      twap: m.twap_at_close,
      resolved_at: m.resolved_at ?? m.closes_at,
      opens_at: m.opens_at,
    }));

  if (query.isLoading) {
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
        <SettledRow key={r.id} row={r} t={t} />
      ))}
    </div>
  );
}

function SettledRow({
  row,
  t,
}: {
  row: RecentRow;
  t: ReturnType<typeof useTranslations<"speed">>;
}) {
  const outcomeLabel =
    row.outcome === "over" ? t("up") : row.outcome === "under" ? t("down") : t("atStrike");
  const outcomeClass =
    row.outcome === "over"
      ? "bg-success/10 text-success ring-success/30"
      : row.outcome === "under"
        ? "bg-destructive/10 text-destructive ring-destructive/30"
        : "bg-warning/10 text-warning ring-warning/30";

  const minutesAgo = Math.max(
    1,
    Math.floor((Date.now() - new Date(row.resolved_at).getTime()) / 60_000)
  );
  const ago = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`;

  return (
    <div className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-xs">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", outcomeClass)}>
        {outcomeLabel}
      </span>
      <span className="font-satoshi font-bold tabular-nums">
        {row.twap !== null ? `$${row.twap.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
      </span>
      <span className="text-[10px] text-muted-custom tabular-nums">{ago}</span>
    </div>
  );
}
