import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import type { MarketWithAmm, AmmState } from "@/types/market";
import type { MarketStatus } from "@/types/database";
import type { Database } from "@/types/database";

// Cookie-free client for cached public queries (no auth needed for public market data)
function getAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function fetchMarketsWithAmm(
  status?: MarketStatus,
  sortBy: string = "closes_at",
  ascending: boolean = true,
  opts: { excludeExpired?: boolean } = {}
): Promise<MarketWithAmm[]> {
  const supabase = getAnonClient();

  // Use Supabase join for amm_state to avoid separate .in() query
  // which fails when there are many markets (URL length limit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any).from("markets").select("*, amm_state:amm_state(*)").order(sortBy, { ascending });
  if (status) {
    query = query.eq("status", status);
  }
  if (opts.excludeExpired) {
    // Drop markets whose close window has passed but the cron hasn't flipped status yet.
    query = query.gt("closes_at", new Date().toISOString());
  }

  const { data: marketsData, error } = await query;
  if (error) {
    logger.error(
      "markets query failed",
      {
        source: "markets-query",
        status,
        sortBy,
        excludeExpired: opts.excludeExpired ?? false,
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
      error
    );
    throw error;
  }
  if (!marketsData?.length) return [];

  return (marketsData as Record<string, unknown>[]).map((m) => {
    // Handle array-vs-object edge case from Supabase joins
    const amm = Array.isArray(m.amm_state) ? m.amm_state[0] : m.amm_state;
    return {
      ...m,
      amm_state: (amm as AmmState) ?? null,
    } as MarketWithAmm;
  });
}

// Plain async exports — no unstable_cache wrapper. The homepage page.tsx already
// has `export const revalidate = 60` (ISR); double-caching just gave us a second
// place where a failed fetch could poison the view for 60s. Throwing on error
// (above) means ISR will keep serving the last-good cache until the next success.
export const getCachedOpenMarkets = () =>
  fetchMarketsWithAmm("open", "trade_count", false, { excludeExpired: true });

export const getCachedAllMarkets = () =>
  fetchMarketsWithAmm(undefined, "closes_at", false);
