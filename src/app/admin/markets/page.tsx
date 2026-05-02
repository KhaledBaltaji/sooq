import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type { Market } from "@/types/market";
import { MarketsTable } from "@/components/admin/markets-table";

export default async function AdminMarketsPage() {
  const supabase = await createClient();

  const { data: markets } = await supabase
    .from("markets")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: ammStates } = await supabase
    .from("amm_state")
    .select("market_id, total_volume, current_yes_price, current_no_price, total_trades");

  const ammMap = new Map<string, any>();
  if (ammStates) {
    for (const amm of ammStates) {
      ammMap.set(amm.market_id, amm);
    }
  }

  const rows = (markets as Market[] || []).map((m) => ({
    ...m,
    amm: ammMap.get(m.id) || null,
  }));

  // Aggregates for bottom cards
  const totalVolume = ammStates?.reduce((s, a) => s + Number(a.total_volume), 0) ?? 0;
  const totalTrades = ammStates?.reduce((s, a) => s + Number(a.total_trades), 0) ?? 0;
  const openMarkets = rows.filter((m) => m.status === "open").length;
  const avgVolume = rows.length > 0 ? totalVolume / rows.length : 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Prediction Markets
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Manage and monitor prediction contracts across the Sooq ecosystem.
          </p>
        </div>
        <Link
          href="/admin/markets/create"
          className="bg-[var(--yes)] hover:bg-[var(--yes)]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Create New Market
        </Link>
      </div>

      {/* Markets Table */}
      <MarketsTable markets={rows} />

      {/* Bottom utility strip */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#e8eff3] p-6 rounded-xl flex flex-col justify-between h-40">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Volume</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{formatCurrency(totalVolume)}</h3>
          </div>
          <p className="text-xs text-[#566166]">Across {rows.length} markets</p>
        </div>
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between h-40 border-l-4 border-[var(--yes)]">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Trades</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{totalTrades.toLocaleString()}</h3>
          </div>
          <p className="text-xs text-[#566166]">All-time across all markets</p>
        </div>
        <div className="relative overflow-hidden bg-[#0b0f10] text-white p-6 rounded-xl flex flex-col justify-between h-40">
          <div className="relative z-10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active Markets</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{openMarkets}</h3>
          </div>
          <div className="relative z-10 text-xs text-slate-300">
            Avg. volume: {formatCurrency(avgVolume)}
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>
    </div>
  );
}
