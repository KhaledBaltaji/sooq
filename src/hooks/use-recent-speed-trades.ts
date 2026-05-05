"use client";

// Polls /api/speed/recent-trades every ~2.5s. Drives the home-page
// Live Trade Tape. Anonymized handles, public-readable, no PII.

import { useQuery } from "@tanstack/react-query";

export interface RecentSpeedTrade {
  trade_id: string;
  created_at: string;
  side: "over" | "under";
  stake_usd: number;
  asset: string;
  duration: "5m" | "15m" | "1h" | "24h";
  who_handle: string;
}

interface ListResponse {
  trades: RecentSpeedTrade[];
}

export function useRecentSpeedTrades(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 10;
  const query = useQuery<ListResponse>({
    queryKey: ["recent-speed-trades", limit],
    queryFn: async () => {
      const res = await fetch(`/api/speed/recent-trades?limit=${limit}`);
      if (!res.ok)
        throw new Error(`Failed to load recent trades (${res.status})`);
      return res.json();
    },
    refetchInterval: 2_500,
    staleTime: 2_000,
  });

  return {
    trades: query.data?.trades ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}
