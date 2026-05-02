"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabase } from "@/components/providers/supabase-provider";
import { cn, formatCurrency } from "@/lib/utils";

interface PerAsset {
  asset: string;
  open_position_count: number;
  open_over_stake: number | string;
  open_under_stake: number | string;
  net_stake: number | string;
}
interface PerBranch {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  speed_status: string;
  pool_balance: number | string;
  fee_share_pct: number | string;
}
interface PerDuration {
  duration: string;
  open_markets: number;
  open_position_count: number;
  open_over_stake: number | string;
  open_under_stake: number | string;
}
interface RvCache {
  status: "fresh" | "stale" | "very_stale" | "missing";
  freshness_seconds: number | null;
  computed_at: string | null;
  threshold_seconds: number;
}
interface LateWindowToday {
  trade_count: number;
  gross_stake: number | string;
  estimated_extra_revenue: number | string;
  pct_of_total_trades: number | string;
}
interface KillSwitches {
  master_enabled: boolean;
  realized_vol_active: boolean;
  late_window_threshold_seconds: number | string;
  late_window_surcharge_active: boolean;
  late_window_surcharge_value: number | string;
}
interface Monitoring {
  rv_cache: RvCache;
  late_window_today: LateWindowToday;
  kill_switches: KillSwitches;
}
interface Overview {
  master_enabled: boolean;
  per_asset: PerAsset[];
  per_branch: PerBranch[];
  per_duration: PerDuration[];
  main_pool_balance: number | string;
  today_revenue: number | string;
  today_payouts: number | string;
  today_gross_stake?: number | string;
  today_effective_edge_pct?: number | string;
  open_markets: number;
  open_positions: number;
  // Mig 360: monitoring section. Optional for backward-compat with cached
  // RPC responses during deploy window; treat undefined as "old payload".
  monitoring?: Monitoring;
  snapshot_at: string;
}

export default function SpeedOperationsPage() {
  const supabase = useSupabase();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: d, error } = await supabase.rpc("speed_admin_overview" as never);
    if (error) {
      setErr(error.message);
    } else {
      setData(d as unknown as Overview);
      setErr(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) {
    return <div className="p-8">Loading…</div>;
  }
  if (err) {
    return (
      <div className="p-8">
        <p className="text-destructive">{err}</p>
      </div>
    );
  }
  if (!data) return null;

  const num = (v: number | string) => Number(v) || 0;

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-destructive" />
          <h1 className="text-3xl font-extrabold">Speed Markets Operations</h1>
        </div>
        <p className="text-sm text-muted-custom">
          Live snapshot, polled every 5s. Last refresh:{" "}
          {new Date(data.snapshot_at).toLocaleTimeString()}.
        </p>
      </header>

      <MasterKillBar enabled={data.master_enabled} onChanged={refresh} />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Open markets" value={String(data.open_markets)} />
        <Stat label="Open positions" value={String(data.open_positions)} />
        <Stat label="Today revenue" value={formatCurrency(num(data.today_revenue))} />
        <Stat label="Today payouts" value={formatCurrency(num(data.today_payouts))} />
        <Stat label="Today gross stake" value={formatCurrency(num(data.today_gross_stake ?? 0))} />
        <Stat
          label="Effective edge"
          value={data.today_effective_edge_pct !== undefined && Number(data.today_effective_edge_pct) > 0
            ? `${Number(data.today_effective_edge_pct).toFixed(2)}%`
            : "—"}
        />
        <Stat label="SOOQ main pool" value={formatCurrency(num(data.main_pool_balance))} mono />
      </section>

      {data.monitoring ? <MonitoringPanel monitoring={data.monitoring} /> : null}

      <section className="space-y-2">
        <h2 className="text-base font-bold uppercase tracking-wide">Per-asset exposure</h2>
        <div className="rounded-xl border border-border-custom bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-[11px] uppercase tracking-wide text-muted-custom">
              <tr>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-right">Open positions</th>
                <th className="px-4 py-3 text-right">OVER stake</th>
                <th className="px-4 py-3 text-right">UNDER stake</th>
                <th className="px-4 py-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.per_asset.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-custom">
                    No open positions
                  </td>
                </tr>
              ) : (
                data.per_asset.map((r) => (
                  <tr key={r.asset} className="border-t border-border-custom">
                    <td className="px-4 py-3 font-bold">{r.asset}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.open_position_count}</td>
                    <td className="px-4 py-3 text-right text-success tabular-nums">{formatCurrency(num(r.open_over_stake))}</td>
                    <td className="px-4 py-3 text-right text-destructive tabular-nums">{formatCurrency(num(r.open_under_stake))}</td>
                    <td className={cn("px-4 py-3 text-right font-bold tabular-nums", num(r.net_stake) >= 0 ? "text-success" : "text-destructive")}>
                      {num(r.net_stake) >= 0 ? "+" : ""}
                      {formatCurrency(num(r.net_stake))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold uppercase tracking-wide">Per-duration</h2>
        <div className="rounded-xl border border-border-custom bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-[11px] uppercase tracking-wide text-muted-custom">
              <tr>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-right">Markets</th>
                <th className="px-4 py-3 text-right">Positions</th>
                <th className="px-4 py-3 text-right">OVER</th>
                <th className="px-4 py-3 text-right">UNDER</th>
              </tr>
            </thead>
            <tbody>
              {data.per_duration.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-custom">No data</td>
                </tr>
              ) : (
                data.per_duration.map((r) => (
                  <tr key={r.duration} className="border-t border-border-custom">
                    <td className="px-4 py-3 font-bold">{r.duration}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.open_markets}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.open_position_count}</td>
                    <td className="px-4 py-3 text-right text-success tabular-nums">{formatCurrency(num(r.open_over_stake))}</td>
                    <td className="px-4 py-3 text-right text-destructive tabular-nums">{formatCurrency(num(r.open_under_stake))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold uppercase tracking-wide">Per-branch</h2>
        <div className="rounded-xl border border-border-custom bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-[11px] uppercase tracking-wide text-muted-custom">
              <tr>
                <th className="px-4 py-3 text-left">Branch</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Pool balance</th>
                <th className="px-4 py-3 text-right">Fee share</th>
              </tr>
            </thead>
            <tbody>
              {data.per_branch.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-custom">
                    No reseller branches speed-enabled
                  </td>
                </tr>
              ) : (
                data.per_branch.map((b) => (
                  <tr key={b.branch_id} className="border-t border-border-custom">
                    <td className="px-4 py-3">
                      <Link href={`/admin/branches/${b.branch_id}`} className="font-bold hover:underline">
                        {b.branch_name}
                      </Link>{" "}
                      <span className="font-mono text-xs text-muted-custom">{b.branch_code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={b.speed_status === "active" ? "default" : b.speed_status === "frozen" || b.speed_status === "suspended" ? "destructive" : "secondary"}>
                        {b.speed_status}
                      </Badge>
                    </td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-bold", num(b.pool_balance) < 0 && "text-destructive")}>
                      {formatCurrency(num(b.pool_balance))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {(num(b.fee_share_pct) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BookSnapshotForm />
    </div>
  );
}

function MasterKillBar({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const supabase = useSupabase();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(rpc: string, args: Record<string, unknown>) {
    if (!pin) {
      setErr("PIN required");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc(rpc as never, args as never);
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setPin("");
      onChanged();
    }
  }

  return (
    <section
      className={cn(
        "rounded-xl border-2 p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between",
        enabled ? "border-success/40 bg-success/5" : "border-destructive/60 bg-destructive/10",
      )}
    >
      <div>
        <div className="text-[10px] uppercase tracking-wide font-bold text-muted-custom">Master kill switch</div>
        <div className={cn("text-2xl font-extrabold", enabled ? "text-success" : "text-destructive")}>
          {enabled ? "ACTIVE" : "DISABLED"}
        </div>
        <div className="text-xs text-muted-custom mt-1">
          {enabled
            ? "Speed markets accepting new bets normally."
            : "New bets blocked. Existing positions resolve at expiry."}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-24"
        />
        {enabled ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => call("speed_admin_master_kill_soft", { p_pin: pin })}
            >
              Soft kill
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (typeof window !== "undefined" && !window.confirm("HARD KILL voids ALL open markets and refunds stakes. Confirm?")) return;
                call("speed_admin_master_kill_hard", { p_pin: pin });
              }}
            >
              HARD kill
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => call("speed_admin_master_revive", { p_pin: pin })}
          >
            Revive
          </Button>
        )}
      </div>
      {err && <div className="text-xs text-destructive md:ml-2">{err}</div>}
    </section>
  );
}

function BookSnapshotForm() {
  const supabase = useSupabase();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    asset: "BTC",
    snapshot_at: new Date().toISOString().slice(0, 16),
    net_position_qty: "0",
    avg_entry_price: "",
    mark_price: "",
    unrealized_pnl_usd: "0",
    realized_pnl_since_last: "0",
    funding_paid_since_last: "0",
    margin_balance_usd: "",
    notes: "",
    pin: "",
  });

  async function submit() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { error } = await supabase.rpc("speed_admin_record_book_snapshot" as never, {
      p_asset: form.asset,
      p_snapshot_at: new Date(form.snapshot_at).toISOString(),
      p_net_position_qty: Number(form.net_position_qty),
      p_avg_entry_price: form.avg_entry_price ? Number(form.avg_entry_price) : null,
      p_mark_price: form.mark_price ? Number(form.mark_price) : null,
      p_unrealized_pnl_usd: Number(form.unrealized_pnl_usd),
      p_realized_pnl_since_last: Number(form.realized_pnl_since_last),
      p_funding_paid_since_last: Number(form.funding_paid_since_last),
      p_margin_balance_usd: form.margin_balance_usd ? Number(form.margin_balance_usd) : null,
      p_notes: form.notes || null,
      p_pin: form.pin,
    } as never);
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setMsg("Snapshot recorded");
      setForm((f) => ({ ...f, pin: "", notes: "" }));
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold uppercase tracking-wide">Daily Binance snapshot</h2>
      <div className="rounded-xl border border-border-custom bg-surface p-5 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Asset">
            <Input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} />
          </Field>
          <Field label="Snapshot at (local)">
            <Input type="datetime-local" value={form.snapshot_at} onChange={(e) => setForm({ ...form, snapshot_at: e.target.value })} />
          </Field>
          <Field label="Net qty">
            <Input value={form.net_position_qty} onChange={(e) => setForm({ ...form, net_position_qty: e.target.value })} type="number" step="0.0001" />
          </Field>
          <Field label="Avg entry price">
            <Input value={form.avg_entry_price} onChange={(e) => setForm({ ...form, avg_entry_price: e.target.value })} type="number" step="0.01" />
          </Field>
          <Field label="Mark price">
            <Input value={form.mark_price} onChange={(e) => setForm({ ...form, mark_price: e.target.value })} type="number" step="0.01" />
          </Field>
          <Field label="Unrealized P&L (USD)">
            <Input value={form.unrealized_pnl_usd} onChange={(e) => setForm({ ...form, unrealized_pnl_usd: e.target.value })} type="number" step="0.01" />
          </Field>
          <Field label="Realized since last">
            <Input value={form.realized_pnl_since_last} onChange={(e) => setForm({ ...form, realized_pnl_since_last: e.target.value })} type="number" step="0.01" />
          </Field>
          <Field label="Funding paid since last">
            <Input value={form.funding_paid_since_last} onChange={(e) => setForm({ ...form, funding_paid_since_last: e.target.value })} type="number" step="0.01" />
          </Field>
          <Field label="Margin balance">
            <Input value={form.margin_balance_usd} onChange={(e) => setForm({ ...form, margin_balance_usd: e.target.value })} type="number" step="0.01" />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
        </Field>
        <Field label="PIN">
          <Input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} type="password" />
        </Field>
        {err && <div className="text-sm text-destructive">{err}</div>}
        {msg && <div className="text-sm text-success">{msg}</div>}
        <Button disabled={busy || !form.pin} onClick={submit} className="w-full md:w-auto">
          {busy ? "…" : "Record snapshot"}
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border-custom bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">{label}</div>
      <div className={cn("font-satoshi text-2xl font-extrabold tabular-nums mt-1", mono && "font-mono")}>{value}</div>
    </div>
  );
}

/**
 * Mig 360 monitoring panel. Four cards in a row:
 *   - RV cache freshness (fresh / stale / very_stale / missing)
 *   - Late-window today (trade count + % of total + estimated extra revenue)
 *   - Kill-switches state (RV, surcharge)
 *   - Pool balance variant repeated for at-a-glance scan
 *
 * Status colors map to runbook severity:
 *   - fresh → success
 *   - stale → warning (functional but degraded)
 *   - very_stale / missing → destructive (action needed)
 */
function MonitoringPanel({ monitoring }: { monitoring: Monitoring }) {
  const rv = monitoring.rv_cache;
  const lw = monitoring.late_window_today;
  const ks = monitoring.kill_switches;
  const num = (v: number | string) => Number(v) || 0;

  const rvStatusColor =
    rv.status === "fresh"
      ? "text-success"
      : rv.status === "stale"
        ? "text-warning"
        : "text-destructive";

  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold uppercase tracking-wide">Monitoring</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* RV cache card */}
        <div className="rounded-xl border border-border-custom bg-surface p-4 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
            RV cache
          </div>
          <div className={cn("text-2xl font-extrabold uppercase", rvStatusColor)}>
            {rv.status}
          </div>
          <div className="text-xs text-muted-custom">
            {rv.freshness_seconds === null
              ? "no cache row — first bootstrap or DB reset"
              : `${rv.freshness_seconds}s old (threshold ${rv.threshold_seconds}s)`}
          </div>
        </div>

        {/* Late window today card */}
        <div className="rounded-xl border border-border-custom bg-surface p-4 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
            Late-window today
          </div>
          <div className="text-2xl font-extrabold tabular-nums">
            {lw.trade_count}{" "}
            <span className="text-base text-muted-custom font-normal">
              ({Number(lw.pct_of_total_trades).toFixed(1)}% of total)
            </span>
          </div>
          <div className="text-xs text-muted-custom">
            +{formatCurrency(num(lw.estimated_extra_revenue))} est. surcharge revenue
          </div>
        </div>

        {/* Kill switches card */}
        <div className="rounded-xl border border-border-custom bg-surface p-4 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-custom font-bold">
            Kill switches
          </div>
          <div className="text-sm space-y-0.5 mt-1">
            <KillSwitchLine label="Master" on={ks.master_enabled} />
            <KillSwitchLine label="Realized vol" on={ks.realized_vol_active} />
            <KillSwitchLine
              label={`Late-window surcharge (${Number(ks.late_window_surcharge_value).toFixed(2)} @ ≤${Number(ks.late_window_threshold_seconds)}s)`}
              on={ks.late_window_surcharge_active}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function KillSwitchLine({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full shrink-0",
          on ? "bg-success" : "bg-destructive",
        )}
        aria-hidden
      />
      <span className={cn(on ? "text-foreground" : "text-destructive font-bold")}>
        {label}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-custom mb-1">{label}</div>
      {children}
    </div>
  );
}
