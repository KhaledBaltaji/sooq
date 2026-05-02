"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  PieChart, Pie, Cell,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import type { StatsMarkets } from "@/types/database";
import Link from "next/link";

const COLORS = ["#2D8CFF", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#6b7280"];

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleMarkets({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsMarkets | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_stats_markets", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as StatsMarkets);
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
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load market stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const p = data.previous_period;
  const categories = (data.categories || []).map((c, i) => ({
    ...c,
    volume: Number(c.volume) || 0,
    count: Number(c.count) || 0,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard icon="analytics" label="Total Markets" value={String(t.total_markets)} />
        <StatsKPICard icon="radio_button_checked" label="Open" value={String(t.open)} color="text-emerald-600" />
        <StatsKPICard icon="lock" label="Closed" value={String(t.closed)} color="text-amber-600" />
        <StatsKPICard icon="check_circle" label="Resolved" value={String(t.resolved)} color="text-[var(--yes)]" />
        <StatsKPICard icon="cancel" label="Voided" value={String(t.voided)} color="text-red-500" />
        <StatsKPICard
          icon="add_circle" label="Created" value={String(t.created_in_period)}
          subtext="this period"
          current={Number(t.created_in_period)} previous={Number(p.created_in_period)}
        />
        <StatsKPICard icon="swap_vert" label="Avg Trades / Mkt" value={String(t.avg_trades_per_market)} />
        <StatsKPICard icon="group" label="Avg Traders / Mkt" value={String(t.avg_traders_per_market)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category breakdown pie */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Markets by Category</h3>
          {categories.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={false}
                >
                  {categories.map((c, i) => (
                    <Cell key={i} fill={c.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                  formatter={(v) => [`${Number(v)} markets`]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-[#566166] text-center py-8">No category data</p>
          )}
        </div>

        {/* Top markets table */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Top 5 Markets by Volume</h3>
          <div className="space-y-3">
            {(data.top_markets || []).map((m, i) => (
              <Link
                key={m.market_id}
                href={`/admin/markets/${m.market_id}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#f0f4f7] transition-colors"
              >
                <span className="text-xs font-bold text-[#566166] w-5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#2a3439] truncate">{m.question}</p>
                  <p className="text-[10px] text-[#566166]">{Number(m.trades)} trades</p>
                </div>
                <span className="text-sm font-bold font-[family-name:var(--font-manrope)] text-[#2a3439]">
                  {formatCurrency(Number(m.volume))}
                </span>
              </Link>
            ))}
            {(!data.top_markets || data.top_markets.length === 0) && (
              <p className="text-sm text-[#566166] text-center py-4">No markets yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
