"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "@/components/admin/stats/stats-kpi-card";

interface SpeedAccountingSummary {
  revenue: {
    handle_fees: number | string;
    spread_revenue: number | string;
    gross_revenue: number | string;
  };
  costs: {
    speed_payouts: number | string;
    speed_commissions_paid: number | string;
    branch_fee_share_paid: number | string;
  };
  previous_period_revenue: {
    gross_revenue: number | string;
  };
  per_branch: Array<{
    branch_id: string | null;
    branch_name: string;
    gross_revenue: number | string;
    gross_stake: number | string;
    pool_p_and_l: number | string;
  }>;
}

/**
 * Speed-market accounting strip for /admin/accounting Platform P&L tab.
 * Reads get_speed_accounting_summary (mig 337) and renders period revenue,
 * costs, and per-branch P&L breakdown.
 *
 * Rendered as a sibling section to the prediction-side Platform P&L module —
 * speed flows tracked separately, never silently merged into prediction totals.
 */
export function SpeedAccountingSection({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const [data, setData] = useState<SpeedAccountingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data: d, error: e } = await supabase.rpc("get_speed_accounting_summary" as never, {
          p_start_date: startDate,
          p_end_date: endDate,
        } as never);
        if (e) throw new Error(e.message);
        setData(d as unknown as SpeedAccountingSummary);
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
      <section className="space-y-3">
        <Header />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <StatsKPICardSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="space-y-3">
        <Header />
        <p className="text-xs text-muted-custom">{error ?? "No speed-market data"}</p>
      </section>
    );
  }

  const num = (v: number | string) => Number(v) || 0;
  const grossRevenue = num(data.revenue.gross_revenue);
  const totalCosts =
    num(data.costs.speed_payouts) +
    num(data.costs.speed_commissions_paid) +
    num(data.costs.branch_fee_share_paid);
  const netPnl = grossRevenue - totalCosts;
  const prevRevenue = num(data.previous_period_revenue.gross_revenue);

  return (
    <section className="space-y-4">
      <Header />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="payments"
          label="Gross Revenue"
          value={formatCurrency(grossRevenue)}
          current={grossRevenue}
          previous={prevRevenue}
        />
        <StatsKPICard
          icon="receipt"
          label="Handle Fees"
          value={formatCurrency(num(data.revenue.handle_fees))}
          subtext="1% of stake"
        />
        <StatsKPICard
          icon="swap_horiz"
          label="Spread Revenue"
          value={formatCurrency(num(data.revenue.spread_revenue))}
          subtext="offered - fair"
        />
        <StatsKPICard
          icon="account_balance"
          label="Net Speed P&L"
          value={formatCurrency(netPnl)}
          color={netPnl >= 0 ? "text-emerald-600" : "text-red-500"}
        />
      </div>

      {data.per_branch.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <h3 className="text-sm font-bold text-[#2a3439] mb-4">Per-Branch Speed P&amp;L</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted-custom border-b border-border-custom">
                <tr>
                  <th className="px-3 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-right">Stake</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Pool P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {data.per_branch.map((row) => (
                  <tr key={row.branch_id ?? "main"} className="border-b border-border-custom last:border-0">
                    <td className="px-3 py-2 font-medium">{row.branch_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(num(row.gross_stake))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(num(row.gross_revenue))}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${num(row.pool_p_and_l) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(num(row.pool_p_and_l))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Zap className="h-4 w-4 text-[#F7931A]" />
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-custom">Speed Markets</h2>
    </div>
  );
}
