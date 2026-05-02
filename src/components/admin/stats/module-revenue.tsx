"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import { SpeedStatsSection } from "./speed-stats-section";
import type { StatsRevenue } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleRevenue({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsRevenue | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_stats_revenue", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as StatsRevenue);
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-3xl text-[#a9b4b9] mb-2 block">error_outline</span>
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load revenue stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const p = data.previous_period;
  const chartData = (data.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    explicit: Number(d.explicit) || 0,
    spread: Number(d.spread) || 0,
    cash_out: Number(d.cash_out) || 0,
    total: Number(d.total) || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="payments" label="Gross Revenue" value={formatCurrency(Number(t.gross_revenue))}
          current={Number(t.gross_revenue)} previous={Number(p.gross_revenue)}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="account_balance" label="Net Revenue" value={formatCurrency(Number(t.net_revenue))}
          current={Number(t.net_revenue)} previous={Number(p.net_revenue)}
          color="text-emerald-600"
        />
        <StatsKPICard icon="receipt" label="Explicit Fees" value={formatCurrency(Number(t.explicit_fees))} subtext="0.5% taker fee" />
        <StatsKPICard icon="swap_horiz" label="AMM Spread" value={formatCurrency(Number(t.amm_spread))} subtext="liquidity spread" />
        <StatsKPICard icon="gavel" label="Resolution Fees" value={formatCurrency(Number(t.resolution_fees))} subtext="1% on winning shares" />
        <StatsKPICard icon="sell" label="Close Premium" value={formatCurrency(Number(t.cash_out_premium))} subtext="0.5% sell penalty" />
        <StatsKPICard
          icon="group" label="Commissions Paid" value={formatCurrency(Number(t.commissions_paid))}
          subtext={`${formatCurrency(Number(t.escrowed_commissions))} escrowed`}
          color="text-amber-600"
        />
        <StatsKPICard icon="analytics" label="Rev / Trade" value={formatCurrency(Number(t.revenue_per_trade))} subtext="avg revenue per trade" />
      </div>

      <SpeedStatsSection startDate={startDate} endDate={endDate} category="revenue" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Revenue Breakdown (Stacked)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v))]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="explicit" name="Explicit Fee" stackId="1" stroke="#2D8CFF" fill="#2D8CFF" fillOpacity={0.3} />
              <Area type="monotone" dataKey="spread" name="AMM Spread" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
              <Area type="monotone" dataKey="cash_out" name="Close Premium" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Daily Total Revenue</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} />
              <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
