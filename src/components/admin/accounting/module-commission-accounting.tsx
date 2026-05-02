"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "../stats/stats-kpi-card";
import type { AccountingCommissions } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

const STATUS_COLORS: Record<string, string> = {
  credited: "#10b981",
  escrowed: "#f59e0b",
  voided: "#94a3b8",
};

const LEVEL_LABELS: Record<number, string> = {
  1: "L1 Bronze",
  2: "L2 Silver",
  3: "L3 Gold",
  4: "L4 Platinum",
};

export function ModuleCommissionAccounting({ startDate, endDate }: Props) {
  const [data, setData] = useState<AccountingCommissions | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_accounting_commissions", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as AccountingCommissions);
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
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load commission accounting</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const byStatus = data.by_status || [];
  const credited = byStatus.find((s) => s.status === "credited");
  const escrowed = byStatus.find((s) => s.status === "escrowed");
  const voided = byStatus.find((s) => s.status === "voided");
  const totalCredited = Number(credited?.total || 0);
  const totalEscrowed = Number(escrowed?.total || 0);
  const totalVoided = Number(voided?.total || 0);
  const netCost = totalCredited + totalEscrowed;

  // Pie chart data
  const pieData = byStatus
    .filter((s) => Number(s.total) > 0)
    .map((s) => ({
      name: s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: Number(s.total),
      color: STATUS_COLORS[s.status] || "#94a3b8",
    }));

  // Level bar chart
  const levelData = (data.by_level || []).map((l) => ({
    name: LEVEL_LABELS[Number(l.level)] || `L${l.level}`,
    total: Number(l.total),
  }));

  const topEarners = data.top_earners || [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard icon="check_circle" label="Credited" value={formatCurrency(totalCredited)} color="text-emerald-600" />
        <StatsKPICard icon="hourglass_top" label="Escrowed" value={formatCurrency(totalEscrowed)} color="text-amber-600" />
        <StatsKPICard icon="block" label="Voided" value={formatCurrency(totalVoided)} color="text-slate-500" />
        <StatsKPICard icon="money_off" label="Net Commission Cost" value={formatCurrency(netCost)} color="text-red-600" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut chart: by status */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Commissions by Status</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                  formatter={(v) => [formatCurrency(Number(v))]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-[#566166] text-xs">No commission data</div>
          )}
        </div>

        {/* Bar chart: by agent level */}
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Commissions by Agent Level</h3>
          {levelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={levelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#566166" }} />
                <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                  formatter={(v) => [formatCurrency(Number(v)), "Commissions"]}
                />
                <Bar dataKey="total" fill="#2D8CFF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-[#566166] text-xs">No level data</div>
          )}
        </div>
      </div>

      {/* Top earners table */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="p-6 border-b border-[#f0f4f7]">
          <h3 className="text-sm font-bold text-[#2a3439]">Top Commission Earners</h3>
          <p className="text-xs text-[#566166] mt-1">Credited commissions in period</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#f8fafb] text-[#566166] uppercase tracking-wider">
                <th className="text-left px-6 py-3 font-bold">#</th>
                <th className="text-left px-4 py-3 font-bold">Agent</th>
                <th className="text-left px-4 py-3 font-bold">Level</th>
                <th className="text-right px-4 py-3 font-bold">Layer 1</th>
                <th className="text-right px-4 py-3 font-bold">Layer 2</th>
                <th className="text-right px-6 py-3 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {topEarners.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-[#566166]">
                    No commission earners in this period.
                  </td>
                </tr>
              ) : (
                topEarners.map((agent, i) => (
                  <tr key={agent.referrer_id} className="border-b border-[#f0f4f7] hover:bg-[#f8fafb]">
                    <td className="px-6 py-3 text-[#566166]">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#2a3439]">{agent.display_name || "—"}</div>
                      <div className="text-[10px] text-[#566166]">{agent.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#f0f4f7] text-[#2a3439]">
                        {LEVEL_LABELS[Number(agent.agent_level)] || `L${agent.agent_level}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[#2a3439]">{formatCurrency(Number(agent.layer_1 || 0))}</td>
                    <td className="px-4 py-3 text-right text-[#566166]">{formatCurrency(Number(agent.layer_2 || 0))}</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-600">{formatCurrency(Number(agent.total))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
