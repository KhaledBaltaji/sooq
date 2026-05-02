"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { formatCurrency } from "@/lib/utils";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";

interface SpeedSummary {
  revenue: {
    handle_fees: number | string;
    spread_revenue: number | string;
    gross_revenue: number | string;
    gross_stake: number | string;
    effective_edge_pct: number | string;
    trade_count: number;
  };
  trading: {
    open_trades: number;
    cashout_trades: number;
    unique_traders: number;
    total_volume: number | string;
  };
  finance: {
    main_pool_balance: number | string;
    branch_pools_total: number | string;
    gross_payouts: number | string;
    gross_stakes_in: number | string;
  };
  markets: {
    open_markets: number;
    resolved_markets: number;
    voided_markets: number;
  };
}

/**
 * Speed-market section for /admin/stats/* tabs. Reads get_speed_stats_summary
 * (mig 337) and renders a strip of KPI cards specific to speed flows.
 *
 * Rendered inside the prediction-side modules (Revenue, Trading, Finance) as a
 * separate visually-distinct strip — speed-prefixed labels, lightning-bolt icon,
 * speed-orange accent. No merging of speed and prediction numbers; admin sees
 * both products side-by-side.
 */
export function SpeedStatsSection({
  startDate,
  endDate,
  category,
}: {
  startDate: string;
  endDate: string;
  category: "revenue" | "trading" | "finance" | "markets";
}) {
  const [data, setData] = useState<SpeedSummary | null>(null);
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
        const { data: d, error: e } = await supabase.rpc("get_speed_stats_summary" as never, {
          p_start_date: startDate,
          p_end_date: endDate,
        } as never);
        if (e) throw new Error(e.message);
        setData(d as unknown as SpeedSummary);
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

  if (category === "revenue") {
    return (
      <section className="space-y-3">
        <Header />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsKPICard icon="payments" label="Speed gross revenue" value={formatCurrency(num(data.revenue.gross_revenue))} />
          <StatsKPICard icon="receipt" label="Speed handle fees" value={formatCurrency(num(data.revenue.handle_fees))} />
          <StatsKPICard icon="swap_horiz" label="Speed spread" value={formatCurrency(num(data.revenue.spread_revenue))} />
          <StatsKPICard
            icon="percent"
            label="Effective edge"
            value={num(data.revenue.gross_stake) > 0
              ? `${Number(data.revenue.effective_edge_pct).toFixed(2)}%`
              : "—"}
          />
        </div>
      </section>
    );
  }

  if (category === "trading") {
    return (
      <section className="space-y-3">
        <Header />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsKPICard icon="bolt" label="Speed open trades" value={String(data.trading.open_trades)} />
          <StatsKPICard icon="undo" label="Speed cashouts" value={String(data.trading.cashout_trades)} />
          <StatsKPICard icon="group" label="Speed traders" value={String(data.trading.unique_traders)} />
          <StatsKPICard icon="show_chart" label="Speed volume" value={formatCurrency(num(data.trading.total_volume))} />
        </div>
      </section>
    );
  }

  if (category === "finance") {
    return (
      <section className="space-y-3">
        <Header />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsKPICard icon="account_balance" label="SOOQ main pool" value={formatCurrency(num(data.finance.main_pool_balance))} />
          <StatsKPICard icon="store" label="Branch pools total" value={formatCurrency(num(data.finance.branch_pools_total))} />
          <StatsKPICard icon="arrow_downward" label="Speed stakes in" value={formatCurrency(num(data.finance.gross_stakes_in))} />
          <StatsKPICard icon="arrow_upward" label="Speed payouts" value={formatCurrency(num(data.finance.gross_payouts))} />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Header />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsKPICard icon="bolt" label="Open speed markets" value={String(data.markets.open_markets)} />
        <StatsKPICard icon="check_circle" label="Resolved (period)" value={String(data.markets.resolved_markets)} />
        <StatsKPICard icon="block" label="Voided (period)" value={String(data.markets.voided_markets)} />
      </div>
    </section>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Zap className="h-4 w-4 text-[#F7931A]" />
      <h3 className="text-sm font-bold uppercase tracking-wide text-muted-custom">Speed Markets</h3>
    </div>
  );
}
