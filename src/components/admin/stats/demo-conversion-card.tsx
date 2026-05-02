"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { StatsKPICard, StatsKPICardSkeleton } from "./stats-kpi-card";

interface DemoConversionStats {
  total_enabled: number;
  total_traded: number;
  total_deposited_after_demo: number;
  trade_rate: number;
  deposit_rate: number;
  median_hours_to_deposit: number;
  cohort_7d: {
    enabled: number;
    deposited: number;
    conversion_rate: number;
  };
  cohort_30d: {
    enabled: number;
    deposited: number;
    conversion_rate: number;
  };
}

/**
 * Admin-only "Demo → Real Conversion" KPI cluster. Wraps get_demo_conversion_stats.
 * Fails silently if the RPC isn't deployed yet — surfaces an inline note.
 */
export function DemoConversionCard() {
  const [stats, setStats] = useState<DemoConversionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data, error } = await supabase.rpc("get_demo_conversion_stats" as never);
      if (error) {
        setError(error.message);
      } else {
        setStats(data as unknown as DemoConversionStats);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatsKPICardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-700">
        Demo conversion stats unavailable: {error ?? "no data"}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">
        Demo → Real Conversion
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKPICard
          icon="person_add"
          label="Enabled demo"
          value={String(stats.total_enabled)}
        />
        <StatsKPICard
          icon="trending_up"
          label="Made a trade"
          value={String(stats.total_traded)}
          subtext={`${stats.trade_rate}% trade rate`}
        />
        <StatsKPICard
          icon="payments"
          label="Deposited after demo"
          value={String(stats.total_deposited_after_demo)}
          subtext={`${stats.deposit_rate}% deposit rate`}
          color="text-emerald-600"
        />
        <StatsKPICard
          icon="schedule"
          label="Median hours to deposit"
          value={`${stats.median_hours_to_deposit}h`}
        />
        <StatsKPICard
          icon="calendar_view_week"
          label="7d cohort"
          value={`${stats.cohort_7d.conversion_rate}%`}
          subtext={`${stats.cohort_7d.deposited}/${stats.cohort_7d.enabled} converted`}
        />
        <StatsKPICard
          icon="calendar_month"
          label="30d cohort"
          value={`${stats.cohort_30d.conversion_rate}%`}
          subtext={`${stats.cohort_30d.deposited}/${stats.cohort_30d.enabled} converted`}
        />
      </div>
    </div>
  );
}
