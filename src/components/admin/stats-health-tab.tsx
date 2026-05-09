"use client";

// Phase 5K — Health tab. Read-only telemetry across oracle, matrix
// coverage, CLV throttle, pricing telemetry, and recent user alerts.

import { useEffect, useState } from "react";
import {
  Activity,
  ShieldCheck,
  GaugeCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface OracleEntry {
  asset: string;
  age_seconds: number;
  stale_threshold_secs: number | null;
}

interface MatrixCoverage {
  asset: string;
  duration: string;
  total: number;
  matrix_count: number;
  matrix_pct: number;
}

interface ClvStatus {
  enabled: boolean;
  active_count: number;
  last_recomputed: string | null;
}

interface AlertEntry {
  type: string;
  user_email: string | null;
  threshold: number | null;
  observed: number | null;
  created_at: string;
}

interface HealthResponse {
  oracle: OracleEntry[];
  matrix_coverage: MatrixCoverage[];
  clv: ClvStatus;
  pricing_telemetry: {
    total_24h: number;
    soft_blocked_24h: number;
    neighbor_fallback_24h: number;
  };
  recent_alerts: AlertEntry[];
}

function oracleTone(o: OracleEntry): "good" | "warn" | "bad" {
  const threshold = o.stale_threshold_secs ?? 5; // global default
  if (o.age_seconds <= threshold) return "good";
  if (o.age_seconds <= threshold * 5) return "warn";
  return "bad";
}

function clvCronTone(iso: string | null): "good" | "warn" | "bad" {
  if (!iso) return "bad";
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ageH < 26) return "good";
  if (ageH < 48) return "warn";
  return "bad";
}

export function StatsHealthTab() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);
    fetch("/api/admin/stats/health-snapshot", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: HealthResponse | { error: string }) => {
        if ("error" in j) setErr(j.error);
        else setData(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e.message ?? "Load failed");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  if (err) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {err}
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="p-8 text-center text-[#566166]">
        <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
        Loading health snapshot…
      </div>
    );
  }
  if (!data) return null;

  const matrixUsedTotal = data.matrix_coverage.reduce(
    (acc, m) => acc + m.matrix_count,
    0,
  );
  const matrixTotal = data.matrix_coverage.reduce((acc, m) => acc + m.total, 0);
  const overallMatrixPct =
    matrixTotal > 0 ? Math.round((matrixUsedTotal / matrixTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Oracle */}
        <Card title="Oracle" icon={<Activity className="w-4 h-4" />}>
          {data.oracle.length === 0 ? (
            <Note>No oracle data yet.</Note>
          ) : (
            <ul className="space-y-2">
              {data.oracle.map((o) => {
                const tone = oracleTone(o);
                return (
                  <li
                    key={o.asset}
                    className="flex items-center justify-between"
                  >
                    <span className="font-bold text-[#2a3439]">{o.asset}</span>
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={
                          tone === "good"
                            ? "text-emerald-700"
                            : tone === "warn"
                              ? "text-amber-700"
                              : "text-red-700"
                        }
                      >
                        ● {o.age_seconds}s old
                      </span>
                      {o.stale_threshold_secs !== null && (
                        <span className="text-xs text-[#717c82]">
                          (threshold {o.stale_threshold_secs}s)
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Matrix coverage */}
        <Card
          title={`Matrix coverage (last 24h) — ${overallMatrixPct}% overall`}
          icon={<GaugeCircle className="w-4 h-4" />}
        >
          {data.matrix_coverage.length === 0 ? (
            <Note>No pricing events in the last 24h.</Note>
          ) : (
            <ul className="space-y-1.5">
              {data.matrix_coverage.map((m) => (
                <li
                  key={`${m.asset}-${m.duration}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-xs text-[#566166]">
                    {m.asset} · {m.duration}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-[#e9ecef] rounded overflow-hidden">
                      <div
                        className="h-full bg-[#2d6cdf]"
                        style={{ width: `${m.matrix_pct}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-[#2a3439] font-semibold w-12 text-right">
                      {m.matrix_pct}%
                    </span>
                    <span className="text-[10px] text-[#717c82] tabular-nums w-16 text-right">
                      {m.matrix_count}/{m.total}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* CLV throttle */}
        <Card title="CLV throttle" icon={<ShieldCheck className="w-4 h-4" />}>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#566166]">Status</span>
              <span
                className={
                  data.clv.enabled
                    ? "font-bold text-emerald-700"
                    : "font-bold text-amber-700"
                }
              >
                {data.clv.enabled ? "● ACTIVE" : "○ DISABLED"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#566166]">Currently shaded</span>
              <Link
                href="/admin/sharks"
                className="font-bold text-[#2d6cdf] hover:underline"
              >
                {data.clv.active_count} user
                {data.clv.active_count === 1 ? "" : "s"} →
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#566166]">Last cron run</span>
              <span
                className={
                  clvCronTone(data.clv.last_recomputed) === "good"
                    ? "text-emerald-700 text-xs"
                    : clvCronTone(data.clv.last_recomputed) === "warn"
                      ? "text-amber-700 text-xs"
                      : "text-red-700 text-xs"
                }
              >
                {data.clv.last_recomputed
                  ? new Date(data.clv.last_recomputed).toLocaleString()
                  : "never"}
              </span>
            </div>
          </div>
        </Card>

        {/* Pricing telemetry */}
        <Card
          title="Pricing telemetry (24h)"
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="space-y-2 text-sm">
            <Stat
              label="Total pricing events"
              value={data.pricing_telemetry.total_24h.toLocaleString()}
            />
            <Stat
              label="Soft-blocked entries"
              value={data.pricing_telemetry.soft_blocked_24h.toLocaleString()}
              tone={
                data.pricing_telemetry.soft_blocked_24h > 0 ? "warn" : "neutral"
              }
            />
            <Stat
              label="Neighbor-fallback cells"
              value={data.pricing_telemetry.neighbor_fallback_24h.toLocaleString()}
              hint="Matrix neighbor used because direct cell not qualifying"
            />
          </div>
        </Card>
      </div>

      {/* Recent alerts feed */}
      <section>
        <h4 className="text-sm font-bold text-[#2a3439] mb-2">
          Recent user alerts (last 10)
        </h4>
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {data.recent_alerts.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#566166]">
              No alerts in the recent window. ✓
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-right px-4 py-3">Threshold</th>
                  <th className="text-right px-4 py-3">Observed</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_alerts.map((a, i) => (
                  <tr
                    key={`${a.created_at}-${i}`}
                    className="border-b border-[#e9ecef]/60 last:border-b-0"
                  >
                    <td className="px-4 py-3 text-xs text-[#566166]">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs truncate max-w-[200px]">
                      {a.user_email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      {a.type}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs">
                      {a.threshold === null ? "—" : a.threshold}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs">
                      {a.observed === null ? "—" : a.observed}
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

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-[#dae2fd] text-[#4a5167] flex items-center justify-center">
          {icon}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-widest text-[#566166]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[#566166]">{label}</div>
        {hint && <div className="text-[10px] text-[#717c82]">{hint}</div>}
      </div>
      <span
        className={
          tone === "warn"
            ? "font-bold text-amber-700 tabular-nums"
            : "font-bold text-[#2a3439] tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[#566166]">{children}</p>;
}
