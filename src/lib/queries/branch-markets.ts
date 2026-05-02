import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { MarketWithAmm, AmmState } from "@/types/market";
import type { BranchPublic, BranchDisplayMode, BranchStatus } from "@/types/branch";
import type { Database } from "@/types/database";

function getAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Fetch branch public data by branch_code.
 * Returns null if not found or branch is suspended.
 */
async function _fetchBranchByCode(branchCode: string): Promise<BranchPublic | null> {
  const supabase = getAnonClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("branches")
    .select("id, name, branch_code, status, display_mode, yes_markup_pct, no_markup_pct, exit_fee_pct, cash_out_enabled")
    .eq("branch_code", branchCode)
    .single() as { data: Record<string, unknown> | null; error: unknown };

  if (error || !data) {
    if (error) console.error("[branch-markets] fetchBranchByCode failed:", branchCode, error);
    return null;
  }

  const status = data.status as BranchStatus;
  // Don't serve suspended branches publicly
  if (status === "suspended") return null;

  return {
    id: data.id as string,
    name: data.name as string,
    branch_code: data.branch_code as string,
    status,
    display_mode: (data.display_mode as BranchDisplayMode) || "betting",
    yes_markup_pct: Number(data.yes_markup_pct) || 0,
    no_markup_pct: Number(data.no_markup_pct) || 0,
    exit_fee_pct: Number(data.exit_fee_pct) || 0,
    cash_out_enabled: Boolean(data.cash_out_enabled),
  };
}

export function fetchBranchByCode(branchCode: string) {
  return unstable_cache(
    () => _fetchBranchByCode(branchCode),
    [`branch-${branchCode}`],
    { revalidate: 60 }
  )();
}

/**
 * Fetch open markets available for a branch.
 * All open markets minus any disabled in branch_market_config.
 */
async function _fetchBranchMarkets(branchId: string): Promise<MarketWithAmm[]> {
  const supabase = getAnonClient();

  // Use Supabase join for amm_state to avoid separate .in() query
  // which fails when there are many markets (URL length limit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [marketsResult, configResult] = await Promise.all([
    (supabase as any).from("markets").select("*, amm_state:amm_state(*)").eq("status", "open").order("trade_count", { ascending: false }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("branch_market_config").select("market_id").eq("branch_id", branchId).eq("is_enabled", false),
  ]);

  if (marketsResult.error) console.error("[branch-markets] fetchBranchMarkets failed:", branchId, marketsResult.error);
  const marketsData = marketsResult.data as Record<string, unknown>[] | null;
  if (!marketsData?.length) return [];

  // Filter out disabled markets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disabledIds = new Set(((configResult as any).data || []).map((c: Record<string, unknown>) => c.market_id as string));
  const enabledMarkets = marketsData.filter((m) => !disabledIds.has(m.id as string));
  if (!enabledMarkets.length) return [];

  return enabledMarkets.map((m) => {
    // Handle array-vs-object edge case from Supabase joins
    const amm = Array.isArray(m.amm_state) ? m.amm_state[0] : m.amm_state;
    return {
      ...m,
      amm_state: (amm as AmmState) ?? null,
    } as MarketWithAmm;
  });
}

export function fetchBranchMarkets(branchId: string) {
  return unstable_cache(
    () => _fetchBranchMarkets(branchId),
    [`branch-markets-${branchId}`],
    { revalidate: 60 }
  )();
}
