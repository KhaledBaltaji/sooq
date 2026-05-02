"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import { SpeedStatsSection } from "./speed-stats-section";
import type { StatsFinance } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

export function ModuleFinance({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsFinance | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_stats_finance", {
          p_start_date: startDate,
          p_end_date: endDate,
        });
        if (e) throw new Error(e.message);
        setData(d as unknown as StatsFinance);
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
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load finance stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const t = data.totals;
  const p = data.previous_period;
  const netFlowColor = Number(t.net_flow) >= 0 ? "text-emerald-600" : "text-red-500";

  const chartData = (data.daily || []).map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    deposits: Number(d.deposits) || 0,
    withdrawals: Number(d.withdrawals) || 0,
    net_flow: Number(d.net_flow) || 0,
  }));

  // Cumulative net flow
  let cumulative = 0;
  const cumulativeData = chartData.map((d) => {
    cumulative += d.net_flow;
    return { ...d, cumulative };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsKPICard
          icon="arrow_downward" label="Deposits" value={formatCurrency(Number(t.total_deposits))}
          subtext={`${t.deposit_count} transactions`}
          current={Number(t.total_deposits)} previous={Number(p.total_deposits)}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="arrow_upward" label="Withdrawals" value={formatCurrency(Number(t.total_withdrawals))}
          subtext={`${t.withdrawal_count} transactions`}
          current={Number(t.total_withdrawals)} previous={Number(p.total_withdrawals)}
          color="text-amber-600"
        />
        <StatsKPICard
          icon="swap_vert" label="Net Flow" value={formatCurrency(Number(t.net_flow))}
          color={netFlowColor}
        />
        <StatsKPICard icon="straighten" label="Avg Deposit" value={formatCurrency(Number(t.avg_deposit))} />
        <StatsKPICard icon="straighten" label="Avg Withdrawal" value={formatCurrency(Number(t.avg_withdrawal))} />
      </div>

      <SpeedStatsSection startDate={startDate} endDate={endDate} category="finance" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsKPICard
          icon="pending" label="Pending Deposits" value={formatCurrency(Number(t.pending_deposits))}
          color={Number(t.pending_deposits) > 0 ? "text-amber-600" : "text-[var(--yes)]"}
        />
        <StatsKPICard
          icon="pending" label="Pending Withdrawals" value={formatCurrency(Number(t.pending_withdrawals))}
          color={Number(t.pending_withdrawals) > 0 ? "text-amber-600" : "text-[var(--yes)]"}
        />
        <StatsKPICard
          icon="conversion_path" label="Deposit → Trade" value={`${t.deposit_to_trade_pct}%`}
          subtext="depositors who also traded"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Deposits vs Withdrawals</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
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
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Cumulative Net Flow</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#566166" }} />
              <YAxis tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v)), "Cumulative Net Flow"]} />
              <Line type="monotone" dataKey="cumulative" stroke="#2D8CFF" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
