"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import { DemoConversionCard } from "./demo-conversion-card";
import type {
  StatsUsers, StatsRevenue, StatsTrading,
  StatsMarkets, StatsFinance, StatsHealth,
} from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

interface OverviewData {
  users: StatsUsers | null;
  revenue: StatsRevenue | null;
  trading: StatsTrading | null;
  markets: StatsMarkets | null;
  finance: StatsFinance | null;
  health: StatsHealth | null;
}

export function StatsOverview({ startDate, endDate }: Props) {
  const [data, setData] = useState<OverviewData>({
    users: null, revenue: null, trading: null,
    markets: null, finance: null, health: null,
  });
  const [loading, setLoading] = useState(true);
  const [failedSections, setFailedSections] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const args = { p_start_date: startDate, p_end_date: endDate };

      const results = await Promise.allSettled([
        supabase.rpc("get_stats_users", args),
        supabase.rpc("get_stats_revenue", args),
        supabase.rpc("get_stats_trading", args),
        supabase.rpc("get_stats_markets", args),
        supabase.rpc("get_stats_finance", args),
        supabase.rpc("get_stats_health", args),
      ]);

      const rpcNames = ["users", "revenue", "trading", "markets", "finance", "health"] as const;
      const failedRpcs: string[] = [];

      const extract = <T,>(r: PromiseSettledResult<{ data: unknown; error: unknown }>, name: string): T | null => {
        if (r.status === "fulfilled" && !r.value.error) return r.value.data as T;
        failedRpcs.push(name);
        return null;
      };

      setData({
        users: extract<StatsUsers>(results[0], rpcNames[0]),
        revenue: extract<StatsRevenue>(results[1], rpcNames[1]),
        trading: extract<StatsTrading>(results[2], rpcNames[2]),
        markets: extract<StatsMarkets>(results[3], rpcNames[3]),
        finance: extract<StatsFinance>(results[4], rpcNames[4]),
        health: extract<StatsHealth>(results[5], rpcNames[5]),
      });
      if (failedRpcs.length > 0) {
        console.error("Stats RPCs failed:", failedRpcs.join(", "));
      }
      setFailedSections(failedRpcs);
      setLoading(false);
    };
    load();
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  const { users, revenue, trading, markets, finance, health } = data;

  // Build volume chart from trading daily data
  const volumeChart = (trading?.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    volume: Number(d.volume) || 0,
    trades: Number(d.trades) || 0,
  }));

  // Build finance chart from finance daily data
  const financeChart = (finance?.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    deposits: Number(d.deposits) || 0,
    withdrawals: Number(d.withdrawals) || 0,
  }));

  // Build users chart
  const usersChart = (users?.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    new_users: Number(d.new_users) || 0,
    active_users: Number(d.active_users) || 0,
  }));

  return (
    <div className="space-y-6">
      {failedSections.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          Failed to load: {failedSections.join(", ")}
        </div>
      )}
      {/* Row 1: Top-line KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="group" label="Total Users"
          value={String(users?.totals.total_users || 0)}
        />
        <StatsKPICard
          icon="show_chart" label="Volume"
          value={formatCurrency(Number(trading?.totals.volume) || 0)}
          current={Number(trading?.totals.volume) || 0}
          previous={Number(trading?.previous_period.volume) || 0}
        />
        <StatsKPICard
          icon="payments" label="Gross Revenue"
          value={formatCurrency(Number(revenue?.totals.gross_revenue) || 0)}
          current={Number(revenue?.totals.gross_revenue) || 0}
          previous={Number(revenue?.previous_period.gross_revenue) || 0}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="swap_vert" label="Net Flow"
          value={formatCurrency(Number(finance?.totals.net_flow) || 0)}
          color={Number(finance?.totals.net_flow) >= 0 ? "text-emerald-600" : "text-red-500"}
        />
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="trending_up" label="Active Traders"
          value={String(users?.totals.active_traders || 0)}
          current={Number(users?.totals.active_traders) || 0}
          previous={Number(users?.previous_period.active_traders) || 0}
        />
        <StatsKPICard
          icon="swap_vert" label="Trades"
          value={String(trading?.totals.trade_count || 0)}
          current={Number(trading?.totals.trade_count) || 0}
          previous={Number(trading?.previous_period.trade_count) || 0}
        />
        <StatsKPICard
          icon="straighten" label="Avg Trade Size"
          value={formatCurrency(Number(trading?.totals.avg_trade_size) || 0)}
        />
        <StatsKPICard
          icon="person_add" label="New Users"
          value={String(users?.totals.new_users || 0)}
          current={Number(users?.totals.new_users) || 0}
          previous={Number(users?.previous_period.new_users) || 0}
        />
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="monitoring" label="Seed P&L"
          value={formatCurrency(Number(health?.amm.total_seed_pnl) || 0)}
          color={Number(health?.amm.total_seed_pnl) >= 0 ? "text-emerald-600" : "text-red-500"}
        />
        <StatsKPICard
          icon="warning" label="Negative P&L Markets"
          value={String(health?.amm.markets_negative_pnl || 0)}
          color={Number(health?.amm.markets_negative_pnl) > 0 ? "text-red-500" : "text-emerald-600"}
        />
        <StatsKPICard
          icon="analytics" label="Active Markets"
          value={String(markets?.totals.open || 0)}
        />
        <StatsKPICard
          icon="group" label="Commissions"
          value={formatCurrency(Number(health?.agents.commissions_credited) || 0)}
          subtext={`${formatCurrency(Number(health?.agents.commissions_escrowed) || 0)} escrowed`}
          color="text-amber-600"
        />
      </div>

      {/* Demo → Real Conversion */}
      <DemoConversionCard />

      {/* Charts */}
      <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="text-sm font-bold text-[#2a3439] mb-4">Volume & Trades</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={volumeChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#566166" }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
              formatter={(v, name) => [name === "volume" ? formatCurrency(Number(v)) : Number(v), name === "volume" ? "Volume" : "Trades"]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="volume" name="Volume" stroke="#2D8CFF" strokeWidth={2.5} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="trades" name="Trades" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="5 5" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Deposits vs Withdrawals</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={financeChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v)), "Value"]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="deposits" name="Deposits" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="withdrawals" name="Withdrawals" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">New Users vs Active Traders</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={usersChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="active_users" name="Active Traders" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="new_users" name="New Users" stroke="#2D8CFF" fill="#2D8CFF" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
