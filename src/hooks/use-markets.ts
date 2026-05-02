"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";
import { queryKeys } from "@/lib/query/keys";
import { useRealtimeInvalidation } from "@/lib/query/realtime-invalidator";
import { fetchMarkets } from "@/lib/query/markets/queries";
import type { MarketStatus } from "@/types/database";

/**
 * Markets list hook, backed by React Query.
 *
 * Returns the same shape as the legacy hook (`{ markets, loading, error,
 * refetch }`) so call sites don't change. Under the hood:
 *   - Data is cached in React Query and shared across every component on the
 *     page that uses this hook — no more N fetches for N cards.
 *   - Realtime changes on `markets` and `amm_state` (or their demo
 *     counterparts) invalidate the query, which triggers a refetch.
 *   - Live and demo caches are isolated via the `isDemo` flag in the key.
 */
export function useMarkets(
  status?: MarketStatus,
  sortBy: string = "closes_at",
  ascending: boolean = true,
) {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const marketsTable = isDemo ? "demo_markets" : "markets";
  const ammTable = isDemo ? "demo_amm_state" : "amm_state";

  const marketsListKey = [
    ...queryKeys.markets.all(isDemo),
    { status, sortBy, ascending },
  ] as const;

  const {
    data: markets = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: marketsListKey,
    queryFn: () => fetchMarkets(supabase, { isDemo, status, sortBy, ascending }),
  });

  // Realtime: refetch whenever markets or AMM state change.
  useRealtimeInvalidation({
    channel: `${marketsTable}-list-realtime`,
    table: marketsTable,
    event: "*",
    invalidates: [marketsListKey],
  });

  useRealtimeInvalidation({
    channel: `${ammTable}-list-realtime`,
    table: ammTable,
    event: "*",
    invalidates: [marketsListKey],
  });

  return {
    markets,
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}
