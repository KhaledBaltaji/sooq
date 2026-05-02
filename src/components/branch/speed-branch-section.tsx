"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSupabase } from "@/components/providers/supabase-provider";
import { cn, formatCurrency } from "@/lib/utils";

interface BranchSummary {
  enabled: boolean;
  branch_id: string;
  speed_status?: string;
  pool_balance?: number | string;
  fee_share_pct?: number | string;
  stake_min?: number | string;
  stake_max?: number | string;
  trackers?: {
    user_book_pl: number | string;
    fee_revenue: number | string;
    collateral: number | string;
  };
  open_position_count?: number;
  today_volume?: number | string;
  snapshot_at?: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amount: number | string;
  balance_after: number | string;
  description: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  inactive: { label: "Inactive", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  warning: { label: "Warning", variant: "outline" },
  frozen: { label: "Frozen", variant: "destructive" },
  suspended: { label: "Suspended", variant: "destructive" },
};

export function SpeedBranchSection({ branchId }: { branchId: string }) {
  const supabase = useSupabase();
  const [summary, setSummary] = useState<BranchSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase.rpc("speed_branch_summary" as never, { p_branch_id: branchId } as never),
      supabase
        .from("speed_pool_ledger" as never)
        .select("id, type, amount, balance_after, description, created_at")
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    setSummary(s as unknown as BranchSummary);
    setLedger((l as unknown as LedgerEntry[]) ?? []);
    setLoading(false);
  }, [supabase, branchId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return null;
  if (!summary || !summary.enabled) return null;

  const num = (v: number | string | undefined) => Number(v ?? 0) || 0;
  const trackers = summary.trackers ?? { user_book_pl: 0, fee_revenue: 0, collateral: 0 };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-destructive" />
        <h2 className="text-2xl font-extrabold">Speed Markets</h2>
        {summary.speed_status && (
          <Badge variant={STATUS_LABEL[summary.speed_status]?.variant ?? "secondary"}>
            {STATUS_LABEL[summary.speed_status]?.label ?? summary.speed_status}
          </Badge>
        )}
      </div>

      {/* Three trackers + pool balance */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tracker
          label="User Book P/L"
          subtitle="Raw, unhedged"
          value={num(trackers.user_book_pl)}
          tone={num(trackers.user_book_pl) >= 0 ? "neutral" : "negative"}
        />
        <Tracker
          label="Fee Revenue"
          subtitle="Real-time accrual"
          value={num(trackers.fee_revenue)}
          tone="positive"
        />
        <Tracker
          label="Collateral"
          subtitle="Admin top-ups + withdrawals"
          value={num(trackers.collateral)}
          tone="neutral"
        />
        <Tracker
          label="Pool balance"
          subtitle="Sum of all entries"
          value={num(summary.pool_balance)}
          tone={num(summary.pool_balance) < 0 ? "negative" : "neutral"}
          highlight
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Open positions" value={String(summary.open_position_count ?? 0)} />
        <Stat label="Today volume" value={formatCurrency(num(summary.today_volume))} />
        <Stat label="Fee share" value={`${(num(summary.fee_share_pct) * 100).toFixed(1)}%`} />
        <Stat label="Stake range" value={`$${num(summary.stake_min)} – $${num(summary.stake_max)}`} />
      </div>

      {ledger.length > 0 && (
        <div className="rounded-xl border border-border-custom bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border-custom bg-bg">
            <h3 className="text-[11px] uppercase tracking-wide text-muted-custom font-bold">Recent activity</h3>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-t border-border-custom first:border-t-0">
                  <td className="px-4 py-2 font-mono text-xs text-muted-custom">{e.type}</td>
                  <td className="px-4 py-2 text-xs text-muted-custom">{e.description}</td>
                  <td className={cn("px-4 py-2 text-right tabular-nums font-bold", num(e.amount) >= 0 ? "text-success" : "text-destructive")}>
                    {num(e.amount) >= 0 ? "+" : ""}
                    {formatCurrency(num(e.amount))}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-muted-custom tabular-nums">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tracker({
  label,
  subtitle,
  value,
  tone,
  highlight = false,
}: {
  label: string;
  subtitle: string;
  value: number;
  tone: "positive" | "negative" | "neutral";
  highlight?: boolean;
}) {
  const color = tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-text";
  return (
    <div className={cn(
      "rounded-xl border p-4",
      highlight ? "border-text/20 bg-surface" : "border-border-custom bg-surface",
    )}>
      <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">{label}</div>
      <div className={cn("font-satoshi text-2xl font-extrabold tabular-nums mt-1", color)}>
        {value >= 0 ? "" : "-"}
        {formatCurrency(Math.abs(value))}
      </div>
      <div className="text-[10px] text-muted-custom mt-0.5">{subtitle}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">{label}</div>
      <div className="font-satoshi text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
