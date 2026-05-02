"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";

/**
 * Fetches YES-price history for a list of markets and returns 12 evenly-sampled
 * points per market. Used by the Trade screen position cards' sparklines.
 *
 * Calls `get_price_history(market_id, '1W')` per market in parallel (or its
 * demo twin). React Query caches the full set for 60s so repeated trade-page
 * visits don't spam the RPC.
 */
const SAMPLE_COUNT = 12;

export function usePositionSparks(marketIds: string[]) {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const rpcName = isDemo ? "demo_get_price_history" : "get_price_history";

  const sortedKey = [...marketIds].sort().join(",");

  return useQuery<Record<string, number[]>>({
    queryKey: ["position-sparks", isDemo, sortedKey],
    enabled: marketIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      if (marketIds.length === 0) return {};

      const results = await Promise.all(
        marketIds.map(async (marketId) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any).rpc(rpcName, {
            p_market_id: marketId,
            p_period: "1W",
          });
          if (error || !data || !Array.isArray(data)) return [marketId, [] as number[]] as const;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prices = (data as any[]).map((r) => Number(r.yes_price)).filter((n) => !Number.isNaN(n));
          if (prices.length === 0) return [marketId, [] as number[]] as const;
          if (prices.length <= SAMPLE_COUNT) return [marketId, prices] as const;
          const step = (prices.length - 1) / (SAMPLE_COUNT - 1);
          const sampled = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
            prices[Math.round(i * step)]
          );
          return [marketId, sampled] as const;
        })
      );

      return Object.fromEntries(results);
    },
  });
}
