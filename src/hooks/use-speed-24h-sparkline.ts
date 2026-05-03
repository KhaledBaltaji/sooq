"use client";

// W7 cutover: 24h sparkline pulls from /api/speed/price-history.

import { useQuery } from "@tanstack/react-query";
import type { SpeedAsset } from "@/types/database";

interface PointsResponse {
  points: Array<{ ts: string; price: number }>;
}

export function useSpeed24hSparkline(asset: SpeedAsset = "BTC") {
  const query = useQuery<PointsResponse>({
    queryKey: ["speed-24h-sparkline", asset],
    queryFn: async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const url = `/api/speed/price-history?asset=${encodeURIComponent(asset)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&max_points=60`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load 24h sparkline (${res.status})`);
      return res.json();
    },
    // 30-minute refresh — sparkline is informational, not trade-critical.
    refetchInterval: 30 * 60 * 1000,
    staleTime: 25 * 60 * 1000,
  });

  const points = (query.data?.points ?? []).map((r) => Number(r.price));
  return { points, loading: query.isLoading };
}
