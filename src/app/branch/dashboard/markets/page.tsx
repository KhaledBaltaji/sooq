import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { BranchMarketsClient } from "@/components/branch/branch-markets-client";
import type { MarketWithAmm, AmmState } from "@/types/market";

export default async function BranchMarketsPage() {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Fetch all markets with AMM state (all statuses, not just open)
  const { data: marketsRaw } = await sb
    .from("markets")
    .select("*, amm_state:amm_state(*)")
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markets = (marketsRaw || []) as Record<string, any>[];

  // Parallel fetches for branch-specific data
  const [configsRes, revenueRes, positionsRes] = await Promise.all([
    sb
      .from("branch_market_config")
      .select("market_id, is_enabled, cash_out_enabled, position_cap_yes, position_cap_no")
      .eq("branch_id", branch.id) as { data: { market_id: string; is_enabled: boolean; cash_out_enabled: boolean | null; position_cap_yes: string | null; position_cap_no: string | null }[] | null },
    sb
      .from("branch_revenue")
      .select("market_id, markup_revenue, explicit_fee_revenue, exit_fee_revenue, resolution_fee_revenue, sooq_fee_revenue, total_revenue")
      .eq("branch_id", branch.id) as { data: Record<string, unknown>[] | null },
    sb
      .from("positions")
      .select("market_id, side, shares_held")
      .eq("branch_id", branch.id)
      .gt("shares_held", 0) as { data: { market_id: string; side: string; shares_held: string }[] | null },
  ]);

  // Build lookup maps
  const configMap = new Map<string, (typeof configsRes.data extends (infer T)[] | null ? T : never)>();
  for (const c of configsRes.data || []) {
    configMap.set(c.market_id, c);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revenueMap = new Map<string, Record<string, any>>();
  for (const r of revenueRes.data || []) {
    revenueMap.set(r.market_id as string, r);
  }

  // Aggregate positions by market
  const exposureMap = new Map<string, { yesShares: number; noShares: number }>();
  for (const p of positionsRes.data || []) {
    const existing = exposureMap.get(p.market_id) || { yesShares: 0, noShares: 0 };
    if (p.side === "yes") existing.yesShares += Number(p.shares_held);
    else existing.noShares += Number(p.shares_held);
    exposureMap.set(p.market_id, existing);
  }

  // Merge into BranchMarketData[]
  const merged = markets.map((m) => {
    const amm = Array.isArray(m.amm_state) ? m.amm_state[0] : m.amm_state;
    const config = configMap.get(m.id as string);
    const rev = revenueMap.get(m.id as string);
    const exp = exposureMap.get(m.id as string) || { yesShares: 0, noShares: 0 };

    return {
      market: {
        ...m,
        amm_state: (amm as AmmState) ?? null,
      } as MarketWithAmm,
      isEnabled: config ? config.is_enabled : true,
      cashOutEnabled: config?.cash_out_enabled ?? null,
      positionCapYes: config?.position_cap_yes ? Number(config.position_cap_yes) : null,
      positionCapNo: config?.position_cap_no ? Number(config.position_cap_no) : null,
      revenue: rev
        ? {
            markup: Number(rev.markup_revenue || 0),
            explicitFee: Number(rev.explicit_fee_revenue || 0),
            exitFee: Number(rev.exit_fee_revenue || 0),
            resolutionFee: Number(rev.resolution_fee_revenue || 0),
            sooqFee: Number(rev.sooq_fee_revenue || 0),
            total: Number(rev.total_revenue || 0),
          }
        : null,
      exposure: exp,
    };
  });

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <section className="space-y-2">
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Markets
        </h2>
        <p className="text-[#566166]">
          Manage markets for your branch — enable, disable, and track performance.
        </p>
      </section>

      <BranchMarketsClient branchId={branch.id as string} markets={merged} />
    </div>
  );
}
