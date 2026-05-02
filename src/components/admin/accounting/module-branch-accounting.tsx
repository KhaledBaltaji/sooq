"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "../stats/stats-kpi-card";
import type { AccountingBranches } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleBranchAccounting({ startDate, endDate }: Props) {
  const [data, setData] = useState<AccountingBranches | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: d, error: e } = await supabase.rpc("get_accounting_branches", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as AccountingBranches);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-3xl text-[#a9b4b9] mb-2 block">error_outline</span>
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load branch accounting</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const sooqFeeRevenue = Number(t.total_sooq_fee_revenue || 0);
  const netToPlatform = sooqFeeRevenue + Number(t.total_branch_revenue) - Number(t.total_agent_payouts);
  const branches = data.branches || [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="store" label="Branch Revenue" value={formatCurrency(Number(t.total_branch_revenue))}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="toll" label="SOOQ Fee Revenue" value={formatCurrency(sooqFeeRevenue)}
          subtext="% of gross buy volume"
          color="text-[#2D8CFF]"
        />
        <StatsKPICard
          icon="group" label="Agent Payouts" value={formatCurrency(Number(t.total_agent_payouts))}
          subtext="Lifetime cumulative"
          color="text-amber-600"
        />
        <StatsKPICard
          icon="account_balance_wallet" label="Net to Platform" value={formatCurrency(netToPlatform)}
          color={netToPlatform >= 0 ? "text-emerald-600" : "text-red-600"}
        />
      </div>

      {/* Revenue breakdown */}
      <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="text-sm font-bold text-[#2a3439] mb-4">Revenue Sources (All Branches)</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Markup Revenue</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(t.total_markup_revenue))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Explicit Fee Revenue</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(t.total_explicit_fee_revenue))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Exit Fee Revenue</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(t.total_exit_fee_revenue))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Resolution Fee Revenue</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(t.total_resolution_fee_revenue))}</span>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <span className="text-[#566166] block mb-1">SOOQ Fee Revenue</span>
            <span className="font-bold text-[#2D8CFF]">{formatCurrency(sooqFeeRevenue)}</span>
          </div>
        </div>
      </div>

      {/* Per-branch table */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="p-6 border-b border-[#f0f4f7]">
          <h3 className="text-sm font-bold text-[#2a3439]">Per-Branch Profitability</h3>
          <p className="text-xs text-[#566166] mt-1">{branches.length} branches with revenue in period</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#f8fafb] text-[#566166] uppercase tracking-wider">
                <th className="text-left px-6 py-3 font-bold">Branch</th>
                <th className="text-left px-4 py-3 font-bold">Status</th>
                <th className="text-right px-4 py-3 font-bold">Gross Revenue</th>
                <th className="text-right px-4 py-3 font-bold">SOOQ Fee</th>
                <th className="text-right px-4 py-3 font-bold">Agent Payouts</th>
                <th className="text-right px-4 py-3 font-bold">Net to Platform</th>
                <th className="text-right px-4 py-3 font-bold">Margin</th>
                <th className="text-right px-6 py-3 font-bold">Agents</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-[#566166]">
                    No branch revenue in this period.
                  </td>
                </tr>
              ) : (
                branches.map((b) => {
                  const rev = Number(b.total_revenue);
                  const sooqFee = Number(b.sooq_fee_revenue || 0);
                  const payouts = Number(b.agent_payouts);
                  const net = sooqFee + rev - payouts;
                  const margin = rev > 0 ? (net / rev) * 100 : 0;
                  return (
                    <tr key={b.branch_id} className="border-b border-[#f0f4f7] hover:bg-[#f8fafb]">
                      <td className="px-6 py-3">
                        <div className="font-medium text-[#2a3439]">{b.branch_name}</div>
                        <div className="text-[10px] text-[#566166]">{b.branch_code} · {((Number(b.branch_fee_rate ?? 0.05)) * 100).toFixed(1)}% fee</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          b.branch_status === "active" ? "bg-emerald-50 text-emerald-700"
                          : b.branch_status === "payback" ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                        }`}>
                          {b.branch_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#2a3439]">{formatCurrency(rev)}</td>
                      <td className="px-4 py-3 text-right text-[#2D8CFF]">{formatCurrency(sooqFee)}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{formatCurrency(payouts)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {formatCurrency(net)}
                      </td>
                      <td className={`px-4 py-3 text-right ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {margin.toFixed(1)}%
                      </td>
                      <td className="px-6 py-3 text-right text-[#566166]">{Number(b.agent_count)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
