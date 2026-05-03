"use client";

// W7 cutover: TanStack Query polling against /api/speed/markets/[id].

import { useQuery } from "@tanstack/react-query";
import type { SpeedMarket } from "@/types/database";

interface SingleResponse {
  market: SpeedMarket;
}

export function useSpeedMarket(id: string | null | undefined) {
  const query = useQuery<SingleResponse>({
    queryKey: ["speed-market", id],
    queryFn: async () => {
      const res = await fetch(`/api/speed/markets/${id}`);
      if (!res.ok) throw new Error(`Failed to load market (${res.status})`);
      return res.json();
    },
    enabled: Boolean(id),
    refetchInterval: 2_000,
    staleTime: 1_500,
  });

  return {
    market: query.data?.market ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
