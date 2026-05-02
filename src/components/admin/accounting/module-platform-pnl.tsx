"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "../stats/stats-kpi-card";
import { SpeedAccountingSection } from "./speed-accounting-section";
import type { AccountingPnL } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModulePlatformPnL({ startDate, endDate }: Props) {
  const [data, setData] = useState<AccountingPnL | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_accounting_pnl", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as AccountingPnL);
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
        {Array.from({ length: 4 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-3xl text-[#a9b4b9] mb-2 block">error_outline</span>
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load P&L</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const rev = data.revenue;
  const costs = data.costs;
  const totalCosts = Number(costs.commissions_credited) + Number(costs.amm_losses);
  const netProfit = Number(rev.gross_revenue) - totalCosts;
  const margin = Number(rev.gross_revenue) > 0 ? (netProfit / Number(rev.gross_revenue)) * 100 : 0;

  const pp = data.previous_period;
  const ppTotalCosts = Number(pp.commissions_credited) + Number(pp.amm_losses);
  const ppNetProfit = Number(pp.gross_revenue) - ppTotalCosts;

  // Waterfall chart data
  const waterfallData = [
    { name: "Gross Revenue", value: Number(rev.gross_revenue), fill: "#10b981" },
    { name: "Commissions", value: -Number(costs.commissions_credited), fill: "#ef4444" },
    { name: "AMM Losses", value: -Number(costs.amm_losses), fill: "#f59e0b" },
    { name: "AMM Gains", value: Number(costs.amm_gains), fill: "#2D8CFF" },
    { name: "Net Profit", value: netProfit, fill: netProfit >= 0 ? "#10b981" : "#ef4444" },
  ];

  // Daily chart data
  const dailyData = (data.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    revenue: Number(d.revenue) || 0,
    commissions: Number(d.commissions) || 0,
    net: (Number(d.revenue) || 0) - (Number(d.commissions) || 0),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="payments" label="Gross Revenue" value={formatCurrency(Number(rev.gross_revenue))}
          current={Number(rev.gross_revenue)} previous={Number(pp.gross_revenue)}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="money_off" label="Total Costs" value={formatCurrency(totalCosts)}
          current={totalCosts} previous={ppTotalCosts}
          color="text-red-600"
        />
        <StatsKPICard
          icon="account_balance_wallet" label="Net Profit" value={formatCurrency(netProfit)}
          current={netProfit} previous={ppNetProfit}
          color={netProfit >= 0 ? "text-emerald-600" : "text-red-600"}
        />
        <StatsKPICard
          icon="percent" label="Profit Margin" value={`${margin.toFixed(1)}%`}
          color={margin >= 0 ? "text-emerald-600" : "text-red-600"}
        />
      </div>

      <SpeedAccountingSection startDate={startDate} endDate={endDate} />

      {/* Revenue breakdown detail */}
      <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="text-sm font-bold text-[#2a3439] mb-4">Revenue & Cost Breakdown</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Explicit Fees</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(rev.explicit_fees))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">AMM Spread</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(rev.amm_spread))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Cash Out Premium</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(rev.cash_out_premium))}</span>
          </div>
          <div className="p-3 bg-[#f0f4f7] rounded-lg">
            <span className="text-[#566166] block mb-1">Resolution Fees</span>
            <span className="font-bold text-[#2a3439]">{formatCurrency(Number(rev.resolution_fees))}</span>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <span className="text-[#566166] block mb-1">Branch Fee Revenue</span>
            <span className="font-bold text-[#2D8CFF]">{formatCurrency(Number(rev.branch_fee_revenue || 0))}</span>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <span className="text-[#566166] block mb-1">Commissions Paid</span>
            <span className="font-bold text-red-600">{formatCurrency(Number(costs.commissions_credited))}</span>
          </div>
          <div className="p-3 bg-amber-50 rounded-lg">
            <span className="text-[#566166] block mb-1">Commissions Escrowed</span>
            <span className="font-bold text-amber-600">{formatCurrency(Number(costs.commissions_escrowed))}</span>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <span className="text-[#566166] block mb-1">AMM Losses</span>
            <span className="font-bold text-red-600">{formatCurrency(Number(costs.amm_losses))}</span>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <span className="text-[#566166] block mb-1">AMM Gains</span>
            <span className="font-bold text-[#2D8CFF]">{formatCurrency(Number(costs.amm_gains))}</span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Waterfall */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">P&L Waterfall</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={waterfallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Math.abs(Number(v))), "Amount"]}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {waterfallData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Daily P&L */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Daily Revenue vs Costs</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v))]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="commissions" name="Commissions" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="net" name="Net" stroke="#2D8CFF" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
