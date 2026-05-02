import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmmState, MarketWithAmm } from "@/types/market";
import type { MarketStatus } from "@/types/database";

export interface FetchMarketsOptions {
  /** Live vs demo tables. */
  isDemo: boolean;
  /** Filter by market status. Omit for all statuses. */
  status?: MarketStatus;
  /** Column to sort by. Default `closes_at`. */
  sortBy?: string;
  /** Sort direction. Default ascending. */
  ascending?: boolean;
}

/**
 * Pure fetch of markets + AMM state from Supabase.
 *
 * Extracted from the original `useMarkets` hook so the same read path is
 * reusable by:
 *   - The React Query client hook (`useMarkets`)
 *   - Future server-side pre-fetch helpers in `src/lib/queries/`
 *
 * Demo mode uses entirely separate tables.
 */
export async function fetchMarkets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  options: FetchMarketsOptions,
): Promise<MarketWithAmm[]> {
  const {
    isDemo,
    status,
    sortBy = "closes_at",
    ascending = true,
  } = options;

  const marketsTable = isDemo ? "demo_markets" : "markets";
  const ammTable = isDemo ? "demo_amm_state" : "amm_state";

  let query = supabase
    .from(marketsTable as never)
    .select("*")
    .order(sortBy, { ascending });

  if (status) {
    query = query.eq("status", status);
  }

  const { data: marketsData, error: marketsError } = await query;
  if (marketsError) {
    throw new Error(marketsError.message);
  }

  const rows = (marketsData ?? []) as MarketWithAmm[];
  const marketIds = rows.map((m) => m.id);

  // Fetch AMM state
  const ammResult = marketIds.length > 0
    ? await supabase.from(ammTable as never).select("*").in("market_id", marketIds)
    : { data: [], error: null };

  if (ammResult.error) {
    console.error("Failed to fetch AMM state:", ammResult.error);
  }

  const ammMap = new Map<string, AmmState>();
  for (const amm of (ammResult.data ?? []) as AmmState[]) {
    ammMap.set(amm.market_id, amm);
  }

  return rows.map((m) => ({
    ...m,
    amm_state: ammMap.get(m.id) ?? null,
  }));
}
