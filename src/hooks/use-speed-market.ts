"use client";

// W7 cutover: TanStack Query polling against /api/speed/markets/[id].
//
// `placeholderData: keepPreviousData` keeps the prior market visible while
// the next round's data is in flight (the round-to-round transition on
// /speed/[id] after `router.replace`). Without it, the SpeedMarketContent
// component falls into its loading-skeleton branch the instant `id` changes
// — that skeleton is NOT a `motion.div`, so the AnimatePresence cross-fade
// keyed by market.id loses its anchor and the swap reads as a hard refresh.
// With it, market data stays continuous → smooth 250ms cross-fade.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
    placeholderData: keepPreviousData,
  });

  return {
    market: query.data?.market ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
