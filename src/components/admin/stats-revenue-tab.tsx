"use client";

// Phase 5K — Revenue tab. Cleaned up from the legacy single-page view:
//   - 4 KPIs (instead of 6 small ones), Platform net is large
//   - 14-day NGR sparkline under the platform-net KPI
//   - NGR breaker status pill
//   - duration filter: all / 5m / 1m / 1h (drops dead 15m/24h)
//   - asset filter applied via prop
//   - bucket table sorted by stakes_in DESC
//   - drill-down sheets (bucket → markets → trades) preserved as today

import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  Wallet,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Kpi } from "./stats-kpi";

type DurationFilter = "all" | "5m" | "1m" | "1h";
type AssetFilter = "all" | "BTC" | "GOLD";

const DURATION_FILTERS: DurationFilter[] = ["all", "5m", "1m", "1h"];

// Dead durations stripped pre-Phase 5 (mig 0040 killed 1h-rolling but kept
// historical FK; 15m/24h were never wired to the active rolling cron).
// We hide their rows from the bucket table even when "All" is selected
// because they show as zero-activity noise.
const ACTIVE_DURATIONS = new Set(["5m", "1m", "1h"]);

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

interface DailyNgrPoint {
  date: string;
  ngr: number;
  stake_in: number;
}

interface NgrBreakerThresholds {
  alert: number;
  soft: number;
  hard: number;
}

export function StatsRevenueTab({
  isoRange,
  asset,
}: {
  isoRange: { from: string | null; to: string | null };
  asset: AssetFilter;
}) {
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [sparkline, setSparkline] = useState<DailyNgrPoint[]>([]);
  const [breaker, setBreaker] = useState<NgrBreakerThresholds | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drilldown stack
  const [drilldownBucket, setDrilldownBucket] = useState<{
    asset: string;
    duration: string;
  } | null>(null);
  const [bucketMarkets, setBucketMarkets] = useState<MarketRow[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);

  const [drilldownMarket, setDrilldownMarket] = useState<MarketRow | null>(null);
  const [marketTrades, setMarketTrades] = useState<TradeRow[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    const summaryParams = new URLSearchParams();
    if (isoRange.from) summaryParams.set("from", isoRange.from);
    if (isoRange.to) summaryParams.set("to", isoRange.to);

    const bucketParams = new URLSearchParams(summaryParams);
    if (durationFilter !== "all") bucketParams.set("duration", durationFilter);

    Promise.all([
      fetch(
        `/api/admin/stats/revenue-summary?${summaryParams.toString()}`,
        { signal: ctrl.signal },
      ).then((r) => r.json()),
      fetch(
        `/api/admin/stats/market-pnl-grouped?${bucketParams.toString()}`,
        { signal: ctrl.signal },
      ).then((r) => r.json()),
      fetch(`/api/admin/stats/daily-ngr`, { signal: ctrl.signal }).then((r) =>
        r.json(),
      ),
      fetch(`/api/fees`, { signal: ctrl.signal })
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([s, b, n, feesResp]) => {
        setSummary(s);
        const allBuckets: BucketRow[] = b.buckets ?? [];
        setBuckets(
          allBuckets
            .filter((row) => ACTIVE_DURATIONS.has(row.duration))
            .filter((row) => asset === "all" || row.asset === asset)
            .sort((a, c) => c.stakes_in - a.stakes_in),
        );
        setSparkline(n.days ?? []);
        const fees = feesResp?.fees;
        if (fees && Array.isArray(fees)) {
          const get = (k: string) =>
            Number(
              fees.find((f: { fee_type: string; rate: number }) => f.fee_type === k)
                ?.rate ?? 0,
            );
          setBreaker({
            alert: get("speed_daily_ngr_alert_usd"),
            soft: get("speed_daily_ngr_soft_block_usd"),
            hard: get("speed_daily_ngr_hard_stop_usd"),
          });
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError")
          setError(err instanceof Error ? err.message : "Load failed");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [isoRange.from, isoRange.to, durationFilter, asset]);

  // Drill-down: fetch markets when bucket opens
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
    fetch(`/api/admin/stats/market-pnl?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        const all: MarketRow[] = data.markets ?? [];
        setBucketMarkets(all.filter((m) => m.asset === drilldownBucket.asset));
      })
      .catch((err) => {
        if (err.name !== "AbortError") setBucketMarkets([]);
      })
      .finally(() => setBucketLoading(false));
    return () => ctrl.abort();
  }, [drilldownBucket, isoRange.from, isoRange.to]);

  useEffect(() => {
    if (!drilldownMarket) {
      setMarketTrades([]);
      return;
    }
    const ctrl = new AbortController();
    setTradesLoading(true);
    const params = new URLSearchParams({ market_id: drilldownMarket.market_id });
    fetch(`/api/admin/stats/market-trades?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((data) => setMarketTrades(data.trades ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setMarketTrades([]);
      })
      .finally(() => setTradesLoading(false));
    return () => ctrl.abort();
  }, [drilldownMarket]);

  // NGR breaker today's status
  const ngrToday = useMemo(() => {
    if (sparkline.length === 0) return null;
    const last = sparkline[sparkline.length - 1];
    return last.ngr;
  }, [sparkline]);

  const breakerTier = useMemo(() => {
    if (ngrToday === null || !breaker) return null;
    if (ngrToday <= breaker.hard) return "hard";
    if (ngrToday <= breaker.soft) return "soft";
    if (ngrToday <= breaker.alert) return "alert";
    return "ok";
  }, [ngrToday, breaker]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* NGR breaker pill */}
      {breakerTier && breaker && ngrToday !== null && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold",
            breakerTier === "ok"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
              : breakerTier === "alert"
                ? "bg-amber-50 border border-amber-200 text-amber-800"
                : breakerTier === "soft"
                  ? "bg-orange-50 border border-orange-200 text-orange-800"
                  : "bg-red-50 border border-red-200 text-red-800",
          )}
        >
          <span>
            {breakerTier === "ok"
              ? "● Today is OK"
              : breakerTier === "alert"
                ? "● Tier 1 — alerting"
                : breakerTier === "soft"
                  ? "● Tier 2 — stake limits reduced"
                  : "● Tier 3 — trading paused"}
          </span>
          <span className="text-xs font-normal opacity-80">
            today NGR {formatCurrency(ngrToday)} · alert{" "}
            {formatCurrency(breaker.alert)} · soft {formatCurrency(breaker.soft)}{" "}
            · hard {formatCurrency(breaker.hard)}
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Gross volume"
          value={summary ? formatCurrency(summary.gross_volume) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="Total stakes opened"
        />
        <KpiPlatformNet
          summary={summary}
          sparkline={sparkline}
        />
        <Kpi
          label="Cashout shortfall"
          value={
            summary ? formatCurrency(summary.cashout_premium_total) : "—"
          }
          icon={<TrendingUp className="w-4 h-4" />}
          tone="muted"
          hint="Σ(stake − cashout) on early exits"
        />
        <Kpi
          label="Open cash pool"
          value={summary ? formatCurrency(summary.open_cash_pool) : "—"}
          icon={<Wallet className="w-4 h-4" />}
          tone="muted"
          hint="Not yet revenue"
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
                    : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]",
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
                        b.platform_net >= 0 ? "text-emerald-700" : "text-red-700",
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

      {/* Drilldown sheets */}
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

function KpiPlatformNet({
  summary,
  sparkline,
}: {
  summary: RevenueSummary | null;
  sparkline: DailyNgrPoint[];
}) {
  const positive = summary && summary.platform_net >= 0;
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-5">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center",
            positive
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700",
          )}
        >
          <TrendingUp className="w-4 h-4" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">
          Platform net
        </span>
      </div>
      <div
        className={cn(
          "text-3xl font-extrabold tabular-nums",
          positive ? "text-emerald-700" : "text-red-700",
        )}
      >
        {summary ? formatCurrency(summary.platform_net) : "—"}
      </div>
      <div className="text-[10px] text-[#717c82] mt-1">stakes − payouts</div>
      <NgrSparkline points={sparkline} />
    </div>
  );
}

function NgrSparkline({ points }: { points: DailyNgrPoint[] }) {
  if (points.length === 0) return null;

  const W = 200;
  const H = 36;
  const max = Math.max(...points.map((p) => p.ngr), 0);
  const min = Math.min(...points.map((p) => p.ngr), 0);
  const range = Math.max(max - min, 1);
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const yFor = (v: number) => H - ((v - min) / range) * H;

  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${yFor(p.ngr).toFixed(2)}`,
    )
    .join(" ");

  const zeroY = yFor(0);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="mt-3"
      aria-label="14-day NGR sparkline"
    >
      <line
        x1="0"
        x2={W}
        y1={zeroY}
        y2={zeroY}
        stroke="#e9ecef"
        strokeDasharray="2 2"
      />
      <path
        d={path}
        fill="none"
        stroke={
          points[points.length - 1].ngr >= 0 ? "#10b981" : "#ef4444"
        }
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={p.date}
          cx={(i * step).toFixed(2)}
          cy={yFor(p.ngr).toFixed(2)}
          r="1.5"
          fill={p.ngr >= 0 ? "#10b981" : "#ef4444"}
        >
          <title>
            {p.date}: {formatCurrency(p.ngr)}
          </title>
        </circle>
      ))}
    </svg>
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
              totalNet >= 0 ? "text-emerald-700" : "text-red-700",
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
                      m.platform_net >= 0 ? "text-emerald-700" : "text-red-700",
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
              market.platform_net >= 0 ? "text-emerald-700" : "text-red-700",
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
                          : "bg-amber-50 text-amber-700",
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
