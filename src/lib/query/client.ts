import { QueryClient } from "@tanstack/react-query";

/**
 * Creates a new QueryClient with defaults tuned for this app.
 *
 * Defaults rationale:
 * - staleTime 30s: most market data is fine for 30s before we re-check.
 *   Critical live data (prices, positions) comes in via Supabase realtime
 *   and is invalidated immediately by `useRealtimeInvalidation`, so stale
 *   reads are only a factor during cold navigation.
 * - gcTime 5min: keep cached data around for back-navigation snappiness.
 * - refetchOnWindowFocus off: we have realtime; focus-refetch would double up.
 * - retry 1: one quick retry on transient failures; avoid long retry storms
 *   for fintech UX (user sees stale error faster → better than hanging).
 *
 * Call this once per browser session via `<QueryProvider>`. Do NOT instantiate
 * a new client on every render — it would wipe the cache each time.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
