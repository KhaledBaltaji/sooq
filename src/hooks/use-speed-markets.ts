"use client";

// W7 cutover: TanStack Query polling against /api/speed/markets.
// Replaces realtime + REST fallback. 1Hz local tick still drops closed
// markets the instant their timer hits 0.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isMarketAligned } from "@/lib/speed/pricing";
import type { SpeedAsset, SpeedDuration, SpeedMarket } from "@/types/database";

interface ListResponse {
  markets: SpeedMarket[];
}

export function useSpeedMarkets(opts?: {
  asset?: SpeedAsset;
  durations?: SpeedDuration[];
}) {
  const [now, setNow] = useState<number>(Date.now());

  // 1Hz tick so closed-but-not-yet-resolved markets drop from the list
  // immediately when their timer hits 0, rather than waiting for the next
  // 10s poll to confirm pg_cron has flipped the row.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const assetKey = opts?.asset ?? "ALL";
  const durKey = (opts?.durations ?? []).slice().sort().join(",");

  const query = useQuery<ListResponse>({
    queryKey: ["speed-markets", assetKey, durKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.asset) params.set("asset", opts.asset);
      params.set("status", "open");
      params.set("limit", "100");
      const res = await fetch(`/api/speed/markets?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load speed markets (${res.status})`);
      return res.json();
    },
    refetchInterval: 10_000,
    staleTime: 9_000,
  });

  const all = query.data?.markets ?? [];

  // Client-side duration filter (server filter is per-key, so passing a list
  // would need multiple queries — easier to fetch all and filter here).
  const filtered = opts?.durations && opts.durations.length > 0
    ? all.filter((m) => opts.durations!.includes(m.duration))
    : all;

  // Drop off-clock test artifacts; surface aligned, currently-live markets;
  // fall back to soonest-upcoming aligned market if nothing is live yet.
  const aligned = filtered.filter((m) => isMarketAligned(m.opens_at, m.duration));
  const live = aligned.filter((m) => {
    const opensAt = new Date(m.opens_at).getTime();
    const closesAt = new Date(m.closes_at).getTime();
    return opensAt <= now && closesAt > now;
  });
  let derived: SpeedMarket[];
  if (live.length > 0) {
    derived = live;
  } else {
    const upcoming = aligned
      .filter((m) => new Date(m.opens_at).getTime() > now)
      .sort((a, b) => a.opens_at.localeCompare(b.opens_at));
    derived = upcoming.length > 0 ? [upcoming[0]] : [];
  }

  return { markets: derived, loading: query.isLoading };
}
