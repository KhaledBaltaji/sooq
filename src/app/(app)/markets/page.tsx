// /markets — full speed-markets list, filtered by duration.
// Slim Sooq port of the prediction-market /markets page. The footer
// /markets?duration=5m|1h links land here pre-filtered. Mig 369: 15m and
// 24h are no longer offered (mig 361 + mig 363); old links fall back to "all".

"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SpeedMarketCard } from "@/components/speed/speed-market-card";
import type { SpeedMarket } from "@/types/database";
import { cn } from "@/lib/utils";

const DURATION_FILTERS = ["all", "5m", "1h"] as const;
type DurationFilter = (typeof DURATION_FILTERS)[number];

interface MarketsResponse {
  markets: SpeedMarket[];
}

async function fetchOpenMarkets(): Promise<SpeedMarket[]> {
  const params = new URLSearchParams({
    asset: "BTC",
    status: "open",
    limit: "100",
    sort: "asc",
  });
  const r = await fetch(`/api/speed/markets?${params.toString()}`);
  if (!r.ok) throw new Error(`Failed to load markets (${r.status})`);
  const body = (await r.json()) as MarketsResponse;
  return body.markets;
}

function MarketsContent() {
  const search = useSearchParams();
  const initialDuration = (search.get("duration") as DurationFilter) ?? "all";
  const [durationFilter, setDurationFilter] = useState<DurationFilter>(
    DURATION_FILTERS.includes(initialDuration) ? initialDuration : "all",
  );

  const openQuery = useQuery({
    queryKey: ["markets-list", "open"],
    queryFn: fetchOpenMarkets,
    refetchInterval: 10_000,
    staleTime: 9_000,
  });

  const visibleMarkets = useMemo(() => {
    const source = openQuery.data ?? [];
    if (durationFilter === "all") return source;
    return source.filter((m) => m.duration === durationFilter);
  }, [durationFilter, openQuery.data]);

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 lg:px-6 lg:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">All markets</h1>
        <p className="text-sm text-muted-custom max-w-2xl">
          Every active BTC speed market.
        </p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        {/* Duration filter */}
        <div className="inline-flex flex-wrap gap-2">
          {DURATION_FILTERS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDurationFilter(d)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-colors",
                durationFilter === d
                  ? "bg-text text-bg"
                  : "bg-surface text-muted-custom hover:text-text border border-border-custom",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {openQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-xl bg-surface"
            />
          ))}
        </div>
      ) : visibleMarkets.length === 0 ? (
        <div className="rounded-xl border border-border-custom bg-surface p-12 text-center">
          <p className="text-sm text-muted-custom">
            No active markets
            {durationFilter !== "all" ? ` for ${durationFilter}` : ""}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleMarkets.map((market, i) => (
            <SpeedMarketCard key={market.id} market={market} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsContent />}>
      <MarketsContent />
    </Suspense>
  );
}
