"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import { SpeedStatsSection } from "./speed-stats-section";
import type { StatsTrading } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleTrading({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsTrading | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_stats_trading", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as StatsTrading);
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
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load trading stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const p = data.previous_period;
  const chartData = (data.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    volume: Number(d.volume) || 0,
    trades: Number(d.trades) || 0,
    buys: Number(d.buys) || 0,
    sells: Number(d.sells) || 0,
  }));

  const buyPct = Number(t.trade_count) > 0
    ? Math.round((Number(t.buy_count) / Number(t.trade_count)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsKPICard
          icon="show_chart" label="Volume" value={formatCurrency(Number(t.volume))}
          current={Number(t.volume)} previous={Number(p.volume)}
        />
        <StatsKPICard
          icon="swap_vert" label="Trades" value={String(t.trade_count)}
          current={Number(t.trade_count)} previous={Number(p.trade_count)}
        />
        <StatsKPICard icon="straighten" label="Avg Trade" value={formatCurrency(Number(t.avg_trade_size))} />
        <StatsKPICard
          icon="group" label="Unique Traders" value={String(t.unique_traders)}
          current={Number(t.unique_traders)} previous={Number(p.unique_traders)}
        />
        <StatsKPICard icon="content_copy" label="Copy Trades" value={String(t.copy_trade_count)} />
      </div>

      <SpeedStatsSection startDate={startDate} endDate={endDate} category="trading" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard icon="arrow_downward" label="Buys" value={String(t.buy_count)} subtext={formatCurrency(Number(t.buy_volume))} color="text-[var(--yes)]" />
        <StatsKPICard icon="arrow_upward" label="Sells" value={String(t.sell_count)} subtext={formatCurrency(Number(t.sell_volume))} color="text-red-500" />
        <StatsKPICard icon="pie_chart" label="Buy/Sell Ratio" value={`${buyPct}% / ${100 - buyPct}%`} />
        <StatsKPICard icon="inventory" label="Shares Outstanding" value={Number(t.total_shares_outstanding).toFixed(0)} />
      </div>

      <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="text-sm font-bold text-[#2a3439] mb-4">Volume Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
            <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
              formatter={(v) => [formatCurrency(Number(v)), "Volume"]} />
            <Line type="monotone" dataKey="volume" stroke="#2D8CFF" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="text-sm font-bold text-[#2a3439] mb-4">Buys vs Sells Per Day</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
            <YAxis tick={{ fontSize: 11, fill: "#566166" }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="buys" name="Buys" fill="#2D8CFF" radius={[4, 4, 0, 0]} />
            <Bar dataKey="sells" name="Sells" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
