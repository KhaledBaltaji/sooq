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
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

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
  withdrawal_fees_collected: number;
  open_cash_pool: number;
  markets_resolved: number;
  markets_voided: number;
  unique_traders: number;
}

interface BucketRow {
  asset: string;
  duration: string;
  markets_total: number;
  markets_resolved: number;
  markets_voided: number;
  total_positions: number;
  winners: number;
  losers: number;
  refunded: number;
  cashed_out: number;
  stakes_in: number;
  payouts_out: number;
  platform_net: number;
  cashout_premium: number;
  last_resolved_at: string | null;
}

interface MarketRow {
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

interface TradeRow {
  trade_id: string;
  kind: string;
  amount: number;
  created_at: string;
  market_id: string;
  market_asset: string;
  market_duration: string;
  market_opens_at: string;
  market_closes_at: string;
  market_status: string;
  market_outcome: string | null;
  position_id: string;
  position_side: string;
  position_stake: number;
  entry_offered_prob: number;
  payout_amount: number | null;
  position_status: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
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
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [users, setUsers] = useState<UserPnl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drilldown layers — bucket → markets sheet → trades sheet (stacked).
  const [drilldownBucket, setDrilldownBucket] =
    useState<{ asset: string; duration: string } | null>(null);
  const [bucketMarkets, setBucketMarkets] = useState<MarketRow[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);

  const [drilldownMarket, setDrilldownMarket] = useState<MarketRow | null>(null);
  const [marketTrades, setMarketTrades] = useState<TradeRow[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  const isoRange = useMemo(() => rangeToISO(range), [range]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryParams = new URLSearchParams();
      if (isoRange.from) summaryParams.set("from", isoRange.from);
      if (isoRange.to) summaryParams.set("to", isoRange.to);

      const bucketParams = new URLSearchParams(summaryParams);
      if (durationFilter !== "all") bucketParams.set("duration", durationFilter);

      const userParams = new URLSearchParams({
        sort: userSort,
        limit: "20",
      });

      const [s, b, u] = await Promise.all([
        fetch(`/api/admin/stats/revenue-summary?${summaryParams.toString()}`).then(
          (r) => r.json()
        ),
        fetch(
          `/api/admin/stats/market-pnl-grouped?${bucketParams.toString()}`
        ).then((r) => r.json()),
        fetch(`/api/admin/stats/user-pnl?${userParams.toString()}`).then((r) =>
          r.json()
        ),
      ]);
      setSummary(s);
      setBuckets(b.buckets ?? []);
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

  // Fetch individual markets when a bucket is opened.
  useEffect(() => {
    if (!drilldownBucket) {
      setBucketMarkets([]);
      return;
    }
    const ctrl = new AbortController();
    setBucketLoading(true);
    const params = new URLSearchParams();
    if (isoRange.from) params.set("from", isoRange.from);
    if (isoRange.to) params.set("to", isoRange.to);
    params.set("duration", drilldownBucket.duration);
    fetch(`/api/admin/stats/market-pnl?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        const all: MarketRow[] = data.markets ?? [];
        // RPC ignores asset filter (it's the same as duration in v1 — only BTC),
        // but defensively narrow here so the sheet is always coherent.
        setBucketMarkets(all.filter((m) => m.asset === drilldownBucket.asset));
      })
      .catch((err) => {
        if (err.name !== "AbortError") setBucketMarkets([]);
      })
      .finally(() => setBucketLoading(false));
    return () => ctrl.abort();
  }, [drilldownBucket, isoRange.from, isoRange.to]);

  // Fetch trades when a market is opened.
  useEffect(() => {
    if (!drilldownMarket) {
      setMarketTrades([]);
      return;
    }
    const ctrl = new AbortController();
    setTradesLoading(true);
    const params = new URLSearchParams({ market_id: drilldownMarket.market_id });
    fetch(`/api/admin/stats/market-trades?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => setMarketTrades(data.trades ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setMarketTrades([]);
      })
      .finally(() => setTradesLoading(false));
    return () => ctrl.abort();
  }, [drilldownMarket]);

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
          label="User cashout shortfall"
          value={summary ? formatCurrency(summary.cashout_premium_total) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="Σ(stake − cashout) on early exits"
        />
        <Kpi
          label="Withdrawal fees"
          value={summary ? formatCurrency(summary.withdrawal_fees_collected) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="Collected on sent withdrawals"
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

      {/* Per-bucket P&L */}
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
          ) : buckets.length === 0 ? (
            <div className="p-8 text-center text-[#566166]">
              No resolved or voided markets in this range.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                  <th className="text-left px-4 py-3">Bucket</th>
                  <th className="text-right px-4 py-3">Markets</th>
                  <th className="text-right px-4 py-3">Positions</th>
                  <th className="text-right px-4 py-3">Stakes in</th>
                  <th className="text-right px-4 py-3">Payouts out</th>
                  <th className="text-right px-4 py-3">Cashout premium</th>
                  <th className="text-right px-4 py-3">Net</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr
                    key={`${b.asset}-${b.duration}`}
                    onClick={() =>
                      setDrilldownBucket({ asset: b.asset, duration: b.duration })
                    }
                    className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc] cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {b.asset} · {b.duration}
                      </div>
                      <div className="text-[10px] text-[#717c82]">
                        {b.markets_resolved} resolved
                        {b.markets_voided > 0 ? ` · ${b.markets_voided} voided` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {b.markets_total}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {b.total_positions}
                      <span className="text-[10px] text-[#717c82] ml-1">
                        ({b.winners}W/{b.losers}L)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(b.stakes_in)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(b.payouts_out)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#566166]">
                      {formatCurrency(b.cashout_premium)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-bold",
                        b.platform_net >= 0 ? "text-emerald-700" : "text-red-700"
                      )}
                    >
                      {b.platform_net >= 0 ? "+" : ""}
                      {formatCurrency(b.platform_net)}
                    </td>
                    <td className="px-4 py-3 text-[#9aa3a8]">
                      <ChevronRight className="w-4 h-4" />
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

      {/* Drilldown sheets — bucket → markets, then market → trades */}
      <Sheet
        open={!!drilldownBucket}
        onOpenChange={(o) => {
          if (!o) {
            setDrilldownBucket(null);
            setDrilldownMarket(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl bg-[var(--bg)] p-0"
        >
          <SheetTitle className="sr-only">
            {drilldownBucket
              ? `${drilldownBucket.asset} · ${drilldownBucket.duration} markets`
              : "Markets"}
          </SheetTitle>
          {drilldownBucket && (
            <BucketDetail
              bucket={drilldownBucket}
              rows={bucketMarkets}
              loading={bucketLoading}
              onPickMarket={setDrilldownMarket}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!drilldownMarket}
        onOpenChange={(o) => {
          if (!o) setDrilldownMarket(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-3xl bg-[var(--bg)] p-0"
        >
          <SheetTitle className="sr-only">
            {drilldownMarket
              ? `${drilldownMarket.asset} · ${drilldownMarket.duration} · ${drilldownMarket.market_id.slice(0, 8)}`
              : "Trades"}
          </SheetTitle>
          {drilldownMarket && (
            <MarketDetail
              market={drilldownMarket}
              trades={marketTrades}
              loading={tradesLoading}
              onBack={() => setDrilldownMarket(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BucketDetail({
  bucket,
  rows,
  loading,
  onPickMarket,
}: {
  bucket: { asset: string; duration: string };
  rows: MarketRow[];
  loading: boolean;
  onPickMarket: (m: MarketRow) => void;
}) {
  const totalNet = rows.reduce((acc, r) => acc + r.platform_net, 0);
  const totalStakes = rows.reduce((acc, r) => acc + r.stakes_in, 0);
  return (
    <div className="flex flex-col h-full bg-[#f7f9fb]">
      <div className="px-6 py-5 border-b border-[#e9ecef] bg-white">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">
          Bucket
        </div>
        <div className="text-xl font-bold text-[#2a3439] mt-0.5">
          {bucket.asset} · {bucket.duration}
        </div>
        <div className="text-xs text-[#566166] mt-1">
          {rows.length} markets · stakes {formatCurrency(totalStakes)} ·{" "}
          <span
            className={cn(
              "font-bold",
              totalNet >= 0 ? "text-emerald-700" : "text-red-700"
            )}
          >
            net {totalNet >= 0 ? "+" : ""}
            {formatCurrency(totalNet)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-[#566166]">
            <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
            Loading markets…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[#566166]">
            No markets in this bucket within the selected range.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                <th className="text-left px-4 py-3">Market</th>
                <th className="text-left px-4 py-3">Closed</th>
                <th className="text-left px-4 py-3">Outcome</th>
                <th className="text-right px-4 py-3">Pos</th>
                <th className="text-right px-4 py-3">Stakes</th>
                <th className="text-right px-4 py-3">Payouts</th>
                <th className="text-right px-4 py-3">Net</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr
                  key={m.market_id}
                  onClick={() => onPickMarket(m)}
                  className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc] cursor-pointer bg-white"
                >
                  <td className="px-4 py-3">
                    <div className="font-mono text-[11px] text-[#566166]">
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
                      <span className="inline-flex items-center gap-1 text-amber-700 text-xs">
                        <XCircle className="w-3 h-3" /> voided
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                        <CheckCircle2 className="w-3 h-3" /> {m.outcome ?? "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.total_positions}
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
                  <td className="px-4 py-3 text-[#9aa3a8]">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MarketDetail({
  market,
  trades,
  loading,
  onBack,
}: {
  market: MarketRow;
  trades: TradeRow[];
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full bg-[#f7f9fb]">
      <div className="px-6 py-5 border-b border-[#e9ecef] bg-white">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-[#566166] hover:text-[#2a3439] mb-2"
        >
          <ArrowLeft className="w-3 h-3" /> Back to markets
        </button>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">
          Market trades
        </div>
        <div className="text-xl font-bold text-[#2a3439] mt-0.5">
          {market.asset} · {market.duration} ·{" "}
          <span className="font-mono text-base">{market.market_id.slice(0, 8)}</span>
        </div>
        <div className="text-xs text-[#566166] mt-1">
          closed {new Date(market.closes_at).toLocaleString()} ·{" "}
          {market.status === "voided" ? (
            <span className="text-amber-700">voided</span>
          ) : (
            <span className="text-emerald-700">outcome {market.outcome ?? "—"}</span>
          )}{" "}
          · stakes {formatCurrency(market.stakes_in)} ·{" "}
          <span
            className={cn(
              "font-bold",
              market.platform_net >= 0 ? "text-emerald-700" : "text-red-700"
            )}
          >
            net {market.platform_net >= 0 ? "+" : ""}
            {formatCurrency(market.platform_net)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-[#566166]">
            <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
            Loading trades…
          </div>
        ) : trades.length === 0 ? (
          <div className="p-8 text-center text-[#566166]">
            No trades for this market.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Kind</th>
                <th className="text-left px-4 py-3">Side</th>
                <th className="text-right px-4 py-3">Stake</th>
                <th className="text-right px-4 py-3">Entry prob</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-right px-4 py-3">Payout</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr
                  key={t.trade_id}
                  className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc] bg-white"
                >
                  <td className="px-4 py-3 text-xs text-[#566166] whitespace-nowrap">
                    {new Date(t.created_at).toLocaleTimeString()}
                    <div className="text-[10px] text-[#9aa3a8]">
                      {new Date(t.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">
                      {t.user_display_name ?? t.user_email ?? "—"}
                    </div>
                    <div className="text-[10px] text-[#9aa3a8]">
                      {t.user_email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        t.kind === "open"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      )}
                    >
                      {t.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.position_side === "over" ? (
                      <span className="text-emerald-700 font-medium">over</span>
                    ) : (
                      <span className="text-red-700 font-medium">under</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(t.position_stake)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-[#566166]">
                    {(t.entry_offered_prob * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(t.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.payout_amount === null ? (
                      <span className="text-[#9aa3a8]">—</span>
                    ) : (
                      formatCurrency(t.payout_amount)
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#566166]">
                    {t.position_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
