"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "../stats/stats-kpi-card";
import type { AccountingAMM } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

type AmmRiskAggregate = {
  cash_in: string;
  worst_case_payout: string;
  net_exposure: string;
};

export function ModuleAmmAccounting({ startDate, endDate }: Props) {
  const [data, setData] = useState<AccountingAMM | null>(null);
  const [risk, setRisk] = useState<AmmRiskAggregate | null>(null);
  const [riskAsOf, setRiskAsOf] = useState<string | null>(null);
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
        const [accounting, riskSnap] = await Promise.all([
          supabase.rpc("get_accounting_amm", {
            p_start_date: startDate,
            p_end_date: endDate,
          }),
          supabase.rpc("get_amm_risk_snapshot"),
        ]);
        if (accounting.error) throw new Error(accounting.error.message);
        setData(accounting.data as unknown as AccountingAMM);
        // Risk RPC is non-critical — if it fails we still show historical accounting
        if (!riskSnap.error && Array.isArray(riskSnap.data)) {
          const agg = (riskSnap.data as unknown[]).find(
            (row: unknown) => (row as { section: string }).section === "aggregate",
          ) as AmmRiskAggregate | undefined;
          setRisk(agg ?? null);
          setRiskAsOf(new Date().toISOString().slice(11, 19));
        }
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
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load AMM accounting</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const agg = data.aggregates;
  const seedPnl = Number(agg.total_seed_pnl);
  const markets = data.markets || [];

  // Top 5 profitable + top 5 unprofitable for chart
  const profitable = markets.filter((m) => Number(m.seed_pnl) >= 0).slice(0, 5);
  const unprofitable = markets.filter((m) => Number(m.seed_pnl) < 0).slice(-5).reverse();
  const chartData = [...profitable, ...unprofitable].map((m) => ({
    name: (m.question_en || "").slice(0, 30) + ((m.question_en || "").length > 30 ? "..." : ""),
    pnl: Number(m.seed_pnl),
  }));

  return (
    <div className="space-y-6">
      {/* Forward-looking exposure (current open/closed markets) — from get_amm_risk_snapshot */}
      {risk && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#566166] text-lg">shield</span>
            <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Current Exposure</h3>
            <span className="text-[10px] text-[#a9b4b9]">retail AMM, right now</span>
            {riskAsOf && (
              <span className="text-[10px] text-[#a9b4b9] ml-auto">as of {riskAsOf} UTC</span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsKPICard
              icon="balance"
              label="Worst-Case Payout"
              value={formatCurrency(Number(risk.worst_case_payout))}
              subtext="if every open market resolves against us"
              color="text-[#2a3439]"
            />
            <StatsKPICard
              icon="payments"
              label="Cash In"
              value={formatCurrency(Number(risk.cash_in))}
              subtext="retail buys minus sells"
              color={Number(risk.cash_in) >= 0 ? "text-emerald-600" : "text-red-500"}
            />
            <StatsKPICard
              icon={Number(risk.net_exposure) > 0 ? "trending_down" : "trending_up"}
              label="Net Exposure"
              value={
                (Number(risk.net_exposure) > 0 ? "-" : "+") +
                formatCurrency(Math.abs(Number(risk.net_exposure)))
              }
              subtext={Number(risk.net_exposure) > 0 ? "AMM could lose" : "AMM profits regardless"}
              color={Number(risk.net_exposure) > 0 ? "text-red-500" : "text-emerald-600"}
            />
            <StatsKPICard
              icon="monitoring"
              label="Solvency"
              value={(() => {
                const cash = Math.max(0, Number(risk.cash_in));
                const worst = Number(risk.worst_case_payout);
                if (worst === 0) return "∞";
                return `${Math.round((cash / worst) * 100)}%`;
              })()}
              subtext="cash ÷ worst-case"
              color="text-[#4a5167]"
            />
          </div>
        </div>
      )}

      {/* Historical realized P&L from resolved markets (original content below) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[#566166] text-lg">history</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Realized — resolved markets in period</h3>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatsKPICard
            icon="monitoring" label="Aggregate Seed P&L" value={formatCurrency(seedPnl)}
            color={seedPnl >= 0 ? "text-emerald-600" : "text-red-600"}
          />
          <StatsKPICard
            icon="trending_up" label="Markets in Profit" value={String(Number(agg.markets_in_profit))}
            subtext={formatCurrency(Number(agg.total_gains)) + " total gains"}
            color="text-emerald-600"
          />
          <StatsKPICard
            icon="trending_down" label="Markets in Loss" value={String(Number(agg.markets_in_loss))}
            subtext={formatCurrency(Number(agg.total_losses)) + " total losses"}
            color="text-red-600"
          />
        </div>
      </div>

      {/* Bar chart: top profitable + unprofitable */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Top Profitable & Unprofitable Markets</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f7" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#566166" }} tickFormatter={(v) => `$${v}`} />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 10, fill: "#566166" }} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                formatter={(v) => [formatCurrency(Number(v)), "Seed P&L"]}
              />
              <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Markets table */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="p-6 border-b border-[#f0f4f7]">
          <h3 className="text-sm font-bold text-[#2a3439]">Resolved Markets — AMM P&L</h3>
          <p className="text-xs text-[#566166] mt-1">{markets.length} markets resolved in period</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#f8fafb] text-[#566166] uppercase tracking-wider">
                <th className="text-left px-6 py-3 font-bold">Market</th>
                <th className="text-left px-4 py-3 font-bold">Outcome</th>
                <th className="text-right px-4 py-3 font-bold">Seed P&L</th>
                <th className="text-right px-4 py-3 font-bold">Volume</th>
                <th className="text-right px-6 py-3 font-bold">Trades</th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[#566166]">
                    No resolved markets in this period.
                  </td>
                </tr>
              ) : (
                markets.map((m) => {
                  const pnl = Number(m.seed_pnl);
                  return (
                    <tr key={m.market_id} className="border-b border-[#f0f4f7] hover:bg-[#f8fafb]">
                      <td className="px-6 py-3 font-medium text-[#2a3439] max-w-[300px] truncate">
                        {m.question_en}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          m.outcome === "yes"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}>
                          {(m.outcome || "").toUpperCase()}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${pnl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                      </td>
                      <td className="px-4 py-3 text-right text-[#566166]">{formatCurrency(Number(m.total_volume))}</td>
                      <td className="px-6 py-3 text-right text-[#566166]">{Number(m.total_trades)}</td>
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
