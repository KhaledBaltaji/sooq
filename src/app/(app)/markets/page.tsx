// /markets — editorial layout: heading + asset/duration pills + table-or-grid
// view + Coming Next block. Mirrors mockup ~/Downloads/Sooq/app/markets-page.jsx.
// Filter state syncs to URL params so /markets?duration=5m still deep-links.

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, List } from "lucide-react";
import { isMarketAligned } from "@/lib/speed/pricing";
import type { SpeedMarket } from "@/types/database";
import { cn } from "@/lib/utils";
import { SpeedMiniCard } from "@/components/speed/speed-mini-card";
import { MarketsTable } from "@/components/speed/markets-table";

// Phase 5B (mig 0046+0052): 5m + 1m active. 1h killed in mig 0040.
// 1m markets only roll when speed_1m_markets_enabled=1; until then the
// 1m tab shows empty state.
const DURATION_FILTERS = ["all", "5m", "1m"] as const;
type DurationFilter = (typeof DURATION_FILTERS)[number];

// Asset filter is here so we can light up Gold/ETH later without redoing
// the page. Today only BTC is live; everything else dims to "soon".
const ASSET_FILTERS = ["all", "BTC"] as const;
type AssetFilter = (typeof ASSET_FILTERS)[number];

type ViewMode = "table" | "grid";
const VIEW_KEY = "sooq-markets-view";

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
  const initialAsset = (search.get("asset") as AssetFilter) ?? "all";
  const [duration, setDuration] = useState<DurationFilter>(
    DURATION_FILTERS.includes(initialDuration) ? initialDuration : "all",
  );
  const [asset, setAsset] = useState<AssetFilter>(
    ASSET_FILTERS.includes(initialAsset) ? initialAsset : "all",
  );
  const [view, setView] = useState<ViewMode>("table");

  // Hydrate view choice from localStorage on mount.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "table") setView(v);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignore
    }
  }, [view]);

  // URL sync — write filter state to query string without a navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (duration === "all") url.searchParams.delete("duration");
    else url.searchParams.set("duration", duration);
    if (asset === "all") url.searchParams.delete("asset");
    else url.searchParams.set("asset", asset);
    window.history.replaceState({}, "", url.toString());
  }, [duration, asset]);

  const openQuery = useQuery({
    queryKey: ["markets-list", "open"],
    queryFn: fetchOpenMarkets,
    refetchInterval: 10_000,
    staleTime: 9_000,
  });

  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visibleMarkets = useMemo(() => {
    const source = openQuery.data ?? [];
    const filtered = source.filter((m) => {
      if (asset !== "all" && m.asset !== asset) return false;
      if (duration !== "all" && m.duration !== duration) return false;
      return true;
    });
    return filtered.filter((m) => {
      if (!isMarketAligned(m.opens_at, m.duration)) return false;
      const opensAt = new Date(m.opens_at).getTime();
      const closesAt = new Date(m.closes_at).getTime();
      return opensAt <= now && closesAt > now;
    });
  }, [asset, duration, openQuery.data, now]);

  const showMobileGrid = true; // table hides itself <md, grid takes over

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-10 md:px-8 md:py-14">
      {/* Editorial heading */}
      <header className="mb-10">
        <div className="mb-3 font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom">
          All markets
        </div>
        <h1 className="max-w-[720px] font-satoshi text-4xl font-black leading-[1.02] tracking-tight text-text md:text-5xl lg:text-[56px]">
          Every active round.
        </h1>
        <p className="mt-3 max-w-[540px] font-dm-sans text-sm leading-relaxed text-muted-custom md:text-[15px]">
          Bitcoin to start, 5-minute and 1-hour rounds. Live pool, live odds,
          live pricing.
        </p>
      </header>

      {/* Filter row */}
      <div className="mb-6 flex flex-wrap items-center gap-7">
        <FilterGroup
          label="Asset"
          value={asset}
          onChange={(v) => setAsset(v as AssetFilter)}
          options={ASSET_FILTERS.map((v) => ({
            v,
            l: v === "all" ? "All" : v === "BTC" ? "Bitcoin" : v,
          }))}
        />
        <FilterGroup
          label="Round"
          value={duration}
          onChange={(v) => setDuration(v as DurationFilter)}
          options={DURATION_FILTERS.map((v) => ({
            v,
            l: v === "all" ? "All" : v,
          }))}
        />
        <div className="ml-auto hidden md:flex gap-1">
          <ViewToggle
            on={view === "table"}
            onClick={() => setView("table")}
            icon={<List className="h-3.5 w-3.5" />}
            label="Table"
          />
          <ViewToggle
            on={view === "grid"}
            onClick={() => setView("grid")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label="Grid"
          />
        </div>
      </div>

      {openQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-2xl bg-surface"
            />
          ))}
        </div>
      ) : visibleMarkets.length === 0 ? (
        <div className="rounded-2xl border border-border-custom bg-surface p-12 text-center">
          <p className="font-dm-sans text-sm text-muted-custom">
            No markets match your filters.
          </p>
        </div>
      ) : view === "table" ? (
        <>
          <MarketsTable markets={visibleMarkets} />
          {/* Mobile fallback — table is desktop-only */}
          {showMobileGrid && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:hidden">
              {visibleMarkets.map((m) => (
                <SpeedMiniCard key={m.id} market={m} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleMarkets.map((m) => (
            <SpeedMiniCard key={m.id} market={m} />
          ))}
        </div>
      )}

      <ComingNext />
    </main>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-satoshi text-[10px] font-bold uppercase tracking-[0.22em] text-muted-custom">
        {label}
      </span>
      <div className="flex gap-1">
        {options.map((o) => {
          const on = o.v === value;
          return (
            <button
              key={o.v}
              onClick={() => onChange(o.v)}
              className={cn(
                "rounded-full px-3 py-1.5 font-satoshi text-xs font-bold tracking-wide transition-colors",
                on
                  ? "bg-text text-bg"
                  : "bg-transparent text-muted-custom hover:text-text",
              )}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ViewToggle({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-satoshi text-xs font-bold tracking-wide transition-colors",
        on
          ? "bg-text text-bg"
          : "bg-transparent text-muted-custom hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ComingNext() {
  const items = [
    { sym: "ETH", name: "Ethereum", rounds: "5m · 1h" },
    { sym: "XAU", name: "Gold", rounds: "5m · 1h" },
    { sym: "OIL", name: "Crude oil", rounds: "1h · 4h" },
    { sym: "EUR", name: "EUR / USD", rounds: "5m · 1h" },
    { sym: "POL", name: "Politics", rounds: "Markets soon" },
    { sym: "SPT", name: "Sports", rounds: "Markets soon" },
  ];
  return (
    <section className="mt-20">
      <div className="mb-5 font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom">
        Coming next
      </div>
      <div className="grid grid-cols-1 gap-x-12 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.sym}
            className="flex items-center gap-3.5 border-b border-border-custom pb-3 opacity-55"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-custom bg-elevated font-satoshi text-[11px] font-black text-muted-custom">
              {it.sym.slice(0, 3)}
            </span>
            <div>
              <div className="font-satoshi text-sm font-bold leading-none text-text">
                {it.name}
              </div>
              <div className="mt-1.5 font-satoshi text-[10px] font-bold uppercase tracking-[0.16em] text-muted-custom">
                {it.rounds}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsContent />}>
      <MarketsContent />
    </Suspense>
  );
}
