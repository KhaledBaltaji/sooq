import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export default async function BranchRevenuePage() {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: revenues } = await sb.from("branch_revenue").select("*").eq("branch_id", branch.id).order("created_at", { ascending: false }).limit(50) as { data: Record<string, any>[] | null };

  // Resolve market names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const marketIds = [...new Set((revenues || []).map((r: Record<string, any>) => r.market_id as string))];
  const { data: markets } = marketIds.length > 0
    ? await supabase.from("markets").select("id, question_en").in("id", marketIds)
    : { data: [] };
  const marketMap = new Map<string, string>();
  for (const m of markets || []) {
    marketMap.set(m.id, m.question_en || "Unknown Market");
  }

  // Totals
  const totalRevenue = (revenues || []).reduce((sum: number, r: Record<string, any>) => sum + Number(r.total_revenue || 0), 0);
  const totalSooqFee = (revenues || []).reduce((sum: number, r: Record<string, any>) => sum + Number(r.sooq_fee_revenue || 0), 0);
  const netRevenue = totalRevenue - totalSooqFee;

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
            Revenue
          </h2>
          <p className="text-[#566166]">Revenue breakdown per resolved market.</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-[#0b0f10] text-white px-6 py-4 rounded-xl">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Gross Revenue</p>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{formatCurrency(totalRevenue)}</p>
          </div>
          <div className="bg-[#0b0f10] text-white px-6 py-4 rounded-xl">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">SOOQ Fee</p>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-red-400">-{formatCurrency(totalSooqFee)}</p>
          </div>
          <div className="bg-[#0b0f10] text-white px-6 py-4 rounded-xl">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Net Revenue</p>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-emerald-400">{formatCurrency(netRevenue)}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Market</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Markup</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Fees</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Exit Fees</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Resolution</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">SOOQ Fee</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {(revenues || []).length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-sm text-[#566166]">No revenue recorded yet</td>
              </tr>
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (revenues || []).map((r: Record<string, any>) => {
                const sooqFee = Number(r.sooq_fee_revenue || 0);
                const total = Number(r.total_revenue || 0);
                return (
                  <tr key={r.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-[#2a3439] max-w-xs truncate">
                      {marketMap.get(r.market_id) || r.market_id?.slice(0, 8)}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">{formatCurrency(Number(r.markup_revenue || 0))}</td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">{formatCurrency(Number(r.explicit_fee_revenue || 0))}</td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">{formatCurrency(Number(r.exit_fee_revenue || 0))}</td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">{formatCurrency(Number(r.resolution_fee_revenue || 0))}</td>
                    <td className="px-6 py-4 text-sm font-mono text-red-500">-{formatCurrency(sooqFee)}</td>
                    <td className="px-6 py-4 text-sm font-mono font-bold text-[#2a3439]">{formatCurrency(total)}</td>
                    <td className="px-6 py-4 text-sm font-mono font-bold text-emerald-600">{formatCurrency(total - sooqFee)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
