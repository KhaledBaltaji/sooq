"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  Wallet,
  Users,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

type Range = "today" | "7d" | "30d" | "all";
// Admin keeps historical durations (15m/24h) as filter options so old data
// is queryable. New markets are 5m + 1h only (mig 369).
type DurationFilter = "all" | "5m" | "1h" | "15m" | "24h";
type UserSort = "winners" | "losers" | "volume";

interface RevenueSummary {
  gross_volume: number;
  total_payouts: number;
  platform_net: number;
  cashout_premium_total: number;
  open_cash_pool: number;
  markets_resolved: number;
  markets_voided: number;
  unique_traders: number;
}

interface MarketPnl {
  market_id: string;
  asset: string;
  duration: string;
  opens_at: string;
  closes_at: string;
  resolved_at: string | null;
  status: string;
  outcome: string | null;
  twap_at_close: number | null;
  total_positions: number;
  winners: number;
  losers: number;
  refunded: number;
  cashed_out: number;
  stakes_in: number;
  payouts_out: number;
  platform_net: number;
  cashout_premium: number;
}

interface UserPnl {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  position_count: number;
  total_stakes: number;
  total_payouts: number;
  net_pnl: number;
  open_positions: number;
  open_stake_total: number;
}

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7d" },
  { key: "30d", label: "Last 30d" },
  { key: "all", label: "All time" },
];

const DURATION_FILTERS: DurationFilter[] = ["all", "5m", "1h", "15m", "24h"];
const USER_SORTS: { key: UserSort; label: string }[] = [
  { key: "winners", label: "Top winners" },
  { key: "losers", label: "Top losers" },
  { key: "volume", label: "Top volume" },
];

function rangeToISO(range: Range): { from: string | null; to: string | null } {
  if (range === "all") return { from: null, to: null };
  const now = new Date();
  const from = new Date(now);
  if (range === "today") from.setHours(0, 0, 0, 0);
  if (range === "7d") from.setDate(now.getDate() - 7);
  if (range === "30d") from.setDate(now.getDate() - 30);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function StatsClient() {
  const [range, setRange] = useState<Range>("7d");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [userSort, setUserSort] = useState<UserSort>("winners");

  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [markets, setMarkets] = useState<MarketPnl[]>([]);
  const [users, setUsers] = useState<UserPnl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isoRange = useMemo(() => rangeToISO(range), [range]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryParams = new URLSearchParams();
      if (isoRange.from) summaryParams.set("from", isoRange.from);
      if (isoRange.to) summaryParams.set("to", isoRange.to);

      const marketParams = new URLSearchParams(summaryParams);
      if (durationFilter !== "all") marketParams.set("duration", durationFilter);

      const userParams = new URLSearchParams({
        sort: userSort,
        limit: "20",
      });

      const [s, m, u] = await Promise.all([
        fetch(`/api/admin/stats/revenue-summary?${summaryParams.toString()}`).then(
          (r) => r.json()
        ),
        fetch(`/api/admin/stats/market-pnl?${marketParams.toString()}`).then(
          (r) => r.json()
        ),
        fetch(`/api/admin/stats/user-pnl?${userParams.toString()}`).then((r) =>
          r.json()
        ),
      ]);
      setSummary(s);
      setMarkets(m.markets ?? []);
      setUsers(u.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, durationFilter, userSort]);

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              "px-4 py-1.5 text-sm font-semibold rounded-md transition-colors",
              range === r.key
                ? "bg-[#2d6cdf] text-white"
                : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
            )}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={fetchAll}
          className="ml-auto p-2 rounded-md text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7]"
          title="Refresh"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi
          label="Gross volume"
          value={summary ? formatCurrency(summary.gross_volume) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="Total stakes opened"
        />
        <Kpi
          label="Platform commission"
          value={summary ? formatCurrency(summary.platform_net) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone={summary && summary.platform_net >= 0 ? "good" : "bad"}
          hint="stakes − payouts"
        />
        <Kpi
          label="Cashout premium"
          value={summary ? formatCurrency(summary.cashout_premium_total) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="From early exits"
        />
        <Kpi
          label="Open cash pool"
          value={summary ? formatCurrency(summary.open_cash_pool) : "—"}
          icon={<Wallet className="w-4 h-4" />}
          tone="muted"
          hint="Not yet revenue"
        />
        <Kpi
          label="Unique traders"
          value={summary ? String(summary.unique_traders) : "—"}
          icon={<Users className="w-4 h-4" />}
          tone="muted"
          hint={
            summary
              ? `${summary.markets_resolved} resolved · ${summary.markets_voided} voided`
              : ""
          }
        />
      </div>

      {/* Per-market P&L */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-xl font-bold text-[#2a3439]">Per-market P&amp;L</h3>
          <div className="inline-flex flex-wrap gap-2">
            {DURATION_FILTERS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDurationFilter(d)}
                className={cn(
                  "px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-md transition-colors",
                  durationFilter === d
                    ? "bg-[#2a3439] text-white"
                    : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {loading && !summary ? (
            <div className="p-8 text-center text-[#566166]">
              <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : markets.length === 0 ? (
            <div className="p-8 text-center text-[#566166]">
              No resolved or voided markets in this range.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                  <th className="text-left px-4 py-3">Market</th>
                  <th className="text-left px-4 py-3">Closed</th>
                  <th className="text-left px-4 py-3">Outcome</th>
                  <th className="text-right px-4 py-3">Positions</th>
                  <th className="text-right px-4 py-3">Stakes in</th>
                  <th className="text-right px-4 py-3">Payouts out</th>
                  <th className="text-right px-4 py-3">Net</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr
                    key={m.market_id}
                    className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {m.asset} · {m.duration}
                      </div>
                      <div className="text-[10px] text-[#717c82] font-mono">
                        {m.market_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#566166]">
                      {m.resolved_at
                        ? new Date(m.resolved_at).toLocaleString()
                        : new Date(m.closes_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {m.status === "voided" ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <XCircle className="w-3 h-3" /> voided
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> {m.outcome ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m.total_positions}
                      <span className="text-[10px] text-[#717c82] ml-1">
                        ({m.winners}W/{m.losers}L)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(m.stakes_in)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(m.payouts_out)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-bold",
                        m.platform_net >= 0 ? "text-emerald-700" : "text-red-700"
                      )}
                    >
                      {m.platform_net >= 0 ? "+" : ""}
                      {formatCurrency(m.platform_net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* User-level stats */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-xl font-bold text-[#2a3439]">User leaderboard</h3>
          <div className="inline-flex gap-2">
            {USER_SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setUserSort(s.key)}
                className={cn(
                  "px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-md transition-colors",
                  userSort === s.key
                    ? "bg-[#2a3439] text-white"
                    : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {users.length === 0 ? (
            <div className="p-8 text-center text-[#566166]">No users yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-right px-4 py-3">Trades</th>
                  <th className="text-right px-4 py-3">Total staked</th>
                  <th className="text-right px-4 py-3">Total paid out</th>
                  <th className="text-right px-4 py-3">Net P&amp;L</th>
                  <th className="text-right px-4 py-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {u.display_name ?? u.email ?? "—"}
                      </div>
                      <div className="text-[10px] text-[#717c82]">
                        {u.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {u.position_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(u.total_stakes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(u.total_payouts)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-bold",
                        u.net_pnl > 0
                          ? "text-emerald-700"
                          : u.net_pnl < 0
                            ? "text-red-700"
                            : ""
                      )}
                    >
                      {u.net_pnl > 0 ? "+" : ""}
                      {formatCurrency(u.net_pnl)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-[#566166]">
                      {u.open_positions}
                      <span className="ml-1">
                        ({formatCurrency(u.open_stake_total)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "good" | "bad" | "muted";
  hint?: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-5">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center",
            tone === "good"
              ? "bg-emerald-50 text-emerald-700"
              : tone === "bad"
                ? "bg-red-50 text-red-700"
                : "bg-[#dae2fd] text-[#4a5167]"
          )}
        >
          {icon}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "text-2xl font-extrabold tabular-nums",
          tone === "good"
            ? "text-emerald-700"
            : tone === "bad"
              ? "text-red-700"
              : "text-[#2a3439]"
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-[#717c82] mt-1">{hint}</div>}
    </div>
  );
}
