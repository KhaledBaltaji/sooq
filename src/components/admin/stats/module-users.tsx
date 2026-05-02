"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import type { StatsUsers } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleUsers({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsUsers | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_stats_users", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as StatsUsers);
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
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-3xl text-[#a9b4b9] mb-2 block">error_outline</span>
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load user stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const p = data.previous_period;
  const chartData = (data.daily || []).map((d) => ({
    ...d,
    date: format(new Date(d.date), "MMM d"),
    new_users: Number(d.new_users) || 0,
    active_users: Number(d.active_users) || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard icon="group" label="Total Users" value={String(t.total_users)} />
        <StatsKPICard
          icon="person_add" label="New Users" value={String(t.new_users)}
          current={t.new_users} previous={p.new_users}
        />
        <StatsKPICard
          icon="trending_up" label="Active Traders" value={String(t.active_traders)}
          current={t.active_traders} previous={p.active_traders}
        />
        <StatsKPICard icon="schedule" label="DAU" value={String(t.dau)} subtext="today" />
        <StatsKPICard icon="date_range" label="WAU" value={String(t.wau)} subtext="last 7 days" />
        <StatsKPICard icon="calendar_month" label="MAU" value={String(t.mau)} subtext="last 30 days" />
        <StatsKPICard
          icon="replay" label="Retention" value={`${t.retention_rate}%`}
          subtext="traders active in both periods"
          color={Number(t.retention_rate) >= 50 ? "text-emerald-600" : "text-amber-600"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">New User Signups</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} />
              <Bar dataKey="new_users" name="New Users" fill="#2D8CFF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Active Traders Per Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} />
              <Area type="monotone" dataKey="active_users" name="Active Traders" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
