"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";
import type { StatsHealth } from "@/types/database";

interface Props {
  startDate: string;
  endDate: string;
}

type AmmRiskAggregate = {
  cash_in: string;
  worst_case_payout: string;
  net_exposure: string;
};

export function ModuleHealth({ startDate, endDate }: Props) {
  const [data, setData] = useState<StatsHealth | null>(null);
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
        const [health, riskSnap] = await Promise.all([
          supabase.rpc("get_stats_health", {
            p_start_date: startDate,
            p_end_date: endDate,
          }),
          supabase.rpc("get_amm_risk_snapshot"),
        ]);
        if (health.error) throw new Error(health.error.message);
        setData(health.data as unknown as StatsHealth);
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <StatsKPICardSkeleton key={i} />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-3xl text-[#a9b4b9] mb-2 block">error_outline</span>
        <p className="text-sm font-semibold text-[#2a3439]">Failed to load health stats</p>
        <p className="text-xs text-[#566166] mt-1">{error}</p>
      </div>
    );
  }

  const { amm, system, agents, engagement } = data;
  const seedPnlColor = Number(amm.total_seed_pnl) >= 0 ? "text-emerald-600" : "text-red-500";
  const hasCritical = Number(system.critical_count) > 0;
  const hasErrors = Number(system.error_count) > 0;
  const dist = agents.level_distribution;

  return (
    <div className="space-y-6">
      {/* Alert banner */}
      {(hasCritical || hasErrors) && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${
          hasCritical ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"
        }`}>
          <span className={`material-symbols-outlined ${hasCritical ? "text-red-600" : "text-amber-600"}`}>
            {hasCritical ? "error" : "warning"}
          </span>
          <p className={`text-sm font-semibold ${hasCritical ? "text-red-800" : "text-amber-800"}`}>
            {hasCritical ? `${system.critical_count} critical error(s)` : `${system.error_count} error(s)`} in this period
          </p>
        </div>
      )}

      {/* AMM Health — combines backward-looking seed P&L with forward-looking exposure */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#566166]">AMM Health</h3>
          {riskAsOf && (
            <span className="text-[10px] text-[#a9b4b9] ml-auto">risk as of {riskAsOf} UTC</span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatsKPICard
            icon="monitoring" label="Seed P&L" value={formatCurrency(Number(amm.total_seed_pnl))}
            color={seedPnlColor}
          />
          <StatsKPICard
            icon="warning" label="Negative P&L Markets" value={String(amm.markets_negative_pnl)}
            color={Number(amm.markets_negative_pnl) > 0 ? "text-red-500" : "text-emerald-600"}
          />
          <StatsKPICard icon="water_drop" label="Total Liquidity" value={formatCurrency(Number(amm.total_liquidity))} />
          {risk && (
            <>
              <StatsKPICard
                icon="balance"
                label="Worst-Case Liability"
                value={formatCurrency(Number(risk.worst_case_payout))}
                subtext="if worst side wins"
                color={Number(risk.net_exposure) > 0 ? "text-red-500" : "text-emerald-600"}
              />
              <StatsKPICard
                icon="shield"
                label="Solvency"
                value={(() => {
                  const cash = Math.max(0, Number(risk.cash_in));
                  const worst = Number(risk.worst_case_payout);
                  if (worst === 0) return "∞";
                  return `${Math.round((cash / worst) * 100)}%`;
                })()}
                subtext={Number(risk.net_exposure) > 0 ? `short ${formatCurrency(Number(risk.net_exposure))}` : "fully covered"}
                color={(() => {
                  const cash = Math.max(0, Number(risk.cash_in));
                  const worst = Number(risk.worst_case_payout);
                  if (worst === 0) return "text-emerald-600";
                  const pct = (cash / worst) * 100;
                  if (pct >= 100) return "text-emerald-600";
                  if (pct >= 80) return "text-amber-600";
                  return "text-red-500";
                })()}
              />
            </>
          )}
        </div>
      </div>

      {/* System */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#566166] mb-3">System</h3>
        <div className="grid grid-cols-2 gap-4">
          <StatsKPICard
            icon="error" label="Errors" value={String(system.error_count)}
            color={hasErrors ? "text-amber-600" : "text-emerald-600"}
          />
          <StatsKPICard
            icon="report" label="Critical" value={String(system.critical_count)}
            color={hasCritical ? "text-red-500" : "text-emerald-600"}
          />
        </div>
      </div>

      {/* Agents */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#566166] mb-3">Agent Network</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsKPICard icon="smart_toy" label="Total Agents" value={String(agents.total_agents)} />
          <StatsKPICard icon="person_add" label="New Agents" value={String(agents.new_agents)} subtext="this period" />
          <StatsKPICard
            icon="payments" label="Commissions Credited" value={formatCurrency(Number(agents.commissions_credited))}
            color="text-emerald-600"
          />
          <StatsKPICard
            icon="lock" label="Commissions Escrowed" value={formatCurrency(Number(agents.commissions_escrowed))}
            color="text-amber-600"
          />
        </div>

        {/* Agent tier distribution */}
        <div className="mt-4 bg-white rounded-xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h4 className="text-xs font-bold text-[#2a3439] mb-3">Agent Level Distribution</h4>
          <div className="flex gap-2 h-8 rounded-lg overflow-hidden">
            {[
              { level: "L1", count: Number(dist.L1), color: "#a9b4b9" },
              { level: "L2", count: Number(dist.L2), color: "#2D8CFF" },
              { level: "L3", count: Number(dist.L3), color: "#8b5cf6" },
              { level: "L4", count: Number(dist.L4), color: "#10b981" },
            ].map((tier) => {
              const total = Number(dist.L1) + Number(dist.L2) + Number(dist.L3) + Number(dist.L4);
              const pct = total > 0 ? (tier.count / total) * 100 : 25;
              return (
                <div
                  key={tier.level}
                  className="flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: tier.color, width: `${Math.max(pct, 5)}%` }}
                  title={`${tier.level}: ${tier.count}`}
                >
                  {tier.count > 0 && `${tier.level} (${tier.count})`}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Engagement */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#566166] mb-3">Engagement</h3>
        <div className="grid grid-cols-2 gap-4">
          <StatsKPICard icon="chat" label="Comments" value={String(engagement.comments_in_period)} subtext="this period" />
          <StatsKPICard icon="content_copy" label="Active Copy Trades" value={String(engagement.active_copy_trades)} />
        </div>
      </div>
    </div>
  );
}
