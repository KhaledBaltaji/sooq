"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { ResponsiveContainer, AreaChart, Area, YAxis, XAxis, Tooltip, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";
import { useThemeColors } from "@/hooks/use-theme-colors";
import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";
import {
  usePriceHistory,
  getAvailablePeriods,
  getDefaultPeriod,
  type TimePeriod,
  type PricePoint,
} from "@/hooks/use-price-history";
import type { AmmState } from "@/types/market";

interface PriceChartProps {
  marketId: string;
  compact?: boolean;
  createdAt?: string;
  className?: string;
  hideExtras?: boolean;
  chartHeight?: string;
  ammState?: AmmState | null;
  /**
   * Branch markup applied to YES side. When > 0, chart line reflects the
   * branch-quoted price (`canonical / (1 - pct)`) instead of canonical AMM.
   * Leave 0 on the main site — only branch storefront pages should pass this.
   */
  yesMarkupPct?: number;
  /** Branch markup applied to NO side. See `yesMarkupPct` for semantics. */
  noMarkupPct?: number;
  /**
   * Opt-in recharts draw-in animation on mount. Used by the mobile
   * featured-markets carousel so each slide's chart reveals itself when
   * it becomes active. Everywhere else leaves this off to match prior behavior.
   */
  animate?: boolean;
  /**
   * When this value changes, the internal `<Area>` element remounts so recharts
   * replays the draw-in animation — without unmounting the chart or refetching
   * its data. Pair with `animate={true}`.
   */
  animationKey?: number;
  /**
   * Force a specific time period instead of the default (age-based) selection.
   * When set, the internal period selector is disabled (non-compact mode only).
   */
  period?: TimePeriod;
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Format X-axis tick labels — Polymarket style */
function fmtAxisTick(ts: number, period: TimePeriod, dataRangeMs?: number): string {
  const d = new Date(ts);
  if (period === "1H" || period === "6H" || period === "1D") {
    // "11:00 AM", "4:00 PM", "12:00 AM"
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  // For ALL period: use time format if data range is short (< 2 days)
  if (period === "ALL" && dataRangeMs && dataRangeMs < 2 * 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  // 1W, 1M, ALL: "Mar 25", "Mar 28"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Compute round X-axis tick positions that snap to clean time boundaries */
function computeXTicks(data: PricePoint[], period: TimePeriod): number[] {
  if (data.length < 2) return [];
  const first = data[0].time;
  const last = data[data.length - 1].time;
  const range = last - first;
  if (range <= 0) return [first];

  // Choose snap interval based on period
  let snapMs: number;
  let targetTicks: number;
  switch (period) {
    case "1H":
      snapMs = 10 * 60 * 1000;  // 10 minutes
      targetTicks = 6;
      break;
    case "6H":
      snapMs = 60 * 60 * 1000;  // 1 hour
      targetTicks = 6;
      break;
    case "1D":
      snapMs = 4 * 60 * 60 * 1000;  // 4 hours
      targetTicks = 6;
      break;
    case "1W":
      snapMs = 24 * 60 * 60 * 1000;  // 1 day
      targetTicks = 7;
      break;
    case "1M":
      snapMs = 3 * 24 * 60 * 60 * 1000;  // 3 days
      targetTicks = 5;
      break;
    case "ALL":
    default: {
      // Dynamic: pick a round interval based on actual data range
      const hours = range / (60 * 60 * 1000);
      const days = hours / 24;
      if (hours <= 1) { snapMs = 10 * 60 * 1000; targetTicks = 6; }
      else if (hours <= 6) { snapMs = 60 * 60 * 1000; targetTicks = 6; }
      else if (days <= 2) { snapMs = 4 * 60 * 60 * 1000; targetTicks = 6; }
      else if (days <= 7) { snapMs = 24 * 60 * 60 * 1000; targetTicks = 7; }
      else if (days <= 30) { snapMs = 3 * 24 * 60 * 60 * 1000; targetTicks = 5; }
      else if (days <= 90) { snapMs = 7 * 24 * 60 * 60 * 1000; targetTicks = Math.min(6, Math.ceil(days / 7)); }
      else { snapMs = 30 * 24 * 60 * 60 * 1000; targetTicks = Math.min(6, Math.ceil(days / 30)); }
      break;
    }
  }

  // Snap first tick up to the next round boundary
  const firstSnapped = Math.ceil(first / snapMs) * snapMs;
  const ticks: number[] = [];
  for (let t = firstSnapped; t <= last; t += snapMs) {
    ticks.push(t);
  }

  // If we got too many ticks, thin them out
  if (ticks.length > targetTicks + 2) {
    const step = Math.ceil(ticks.length / targetTicks);
    return ticks.filter((_, i) => i % step === 0);
  }

  return ticks;
}

function fmtHoverTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

function fmtCreatedDate(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Compute auto-zoomed [min, max] domain with padding — wider than data */
function computeDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const range = hi - lo;
  // Balanced padding — enough room to breathe without feeling empty
  const pad = Math.max(range * 0.4, 0.06);
  lo = Math.max(0, lo - pad);
  hi = Math.min(1, hi + pad);
  // Minimum visible range of 15%
  if (hi - lo < 0.15) {
    const mid = (lo + hi) / 2;
    lo = Math.max(0, mid - 0.075);
    hi = Math.min(1, mid + 0.075);
  }
  return [lo, hi];
}

function computeTicks(domain: [number, number]): number[] {
  const [lo, hi] = domain;
  const step = (hi - lo) / 4;
  return Array.from({ length: 5 }, (_, i) => Math.round((lo + step * i) * 100) / 100);
}

// ─── Custom tooltip ────────────────────────────────────────────────

function ChartTooltip({ active, payload, colors }: any) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload as PricePoint | undefined;
  if (!point) return null;

  const yesPct = Math.round(point.yes * 100);
  const noPct = Math.round(point.no * 100);

  return (
    <div
      style={{
        background: colors.elevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        lineHeight: "18px",
        pointerEvents: "none",
      }}
    >
      <div style={{ color: colors.muted, marginBottom: 4, fontSize: 11 }}>
        {fmtHoverTime(point.time)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: colors.yes, fontWeight: 700 }}>Yes {yesPct}%</span>
        <span style={{ color: colors.no, fontWeight: 600, opacity: 0.7 }}>No {noPct}%</span>
      </div>
    </div>
  );
}

// ─── Glow dot at end of line ───────────────────────────────────────

function GlowDot({ cx, cy, index, dataLength, color }: any) {
  if (index !== dataLength - 1) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={color} opacity={0.2} />
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
    </g>
  );
}

// Stylized placeholder for the compact loading state. Renders as a gentle
// wave so the carousel hero card never shows an empty gray rectangle while
// the real price history is fetching.
const LOADING_PLACEHOLDER_DATA: PricePoint[] = [
  100, 102, 99, 104, 108, 106, 110, 113, 109, 107, 111, 115, 119, 116, 112,
  114, 117, 121, 118, 115, 120, 123, 119, 117, 121, 125, 128, 124, 122, 126,
].map((value, idx) => ({ time: idx, yes: value, no: 100 - value }));

// ─── Main component ────────────────────────────────────────────────

export function PriceChart({
  marketId,
  compact = false,
  createdAt,
  className,
  hideExtras = false,
  chartHeight,
  ammState,
  yesMarkupPct = 0,
  noMarkupPct = 0,
  animate = false,
  animationKey,
  period: periodProp,
}: PriceChartProps) {
  const colors = useThemeColors();
  const t = useTranslations("market");
  const availablePeriods = useMemo(() => getAvailablePeriods(createdAt), [createdAt]);
  const [periodState, setPeriod] = useState<TimePeriod>(() => periodProp ?? getDefaultPeriod(createdAt));
  const period = periodProp ?? periodState;
  const [showBothOutcomes, setShowBothOutcomes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);

  // ─── Close settings on outside click ──────────────────────────
  useEffect(() => {
    if (!showSettings) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSettings]);

  // ─── Shared price history hook ────────────────────────────────
  const { data: chartData, loading } = usePriceHistory(
    marketId,
    period,
    createdAt,
    ammState,
    yesMarkupPct,
    noMarkupPct,
  );

  // ─── Y-axis: ONE shared dynamic axis (Polymarket-style) ──────
  const yDomain = useMemo<[number, number]>(() => {
    const vals = showBothOutcomes
      ? [...chartData.map((d) => d.yes), ...chartData.map((d) => d.no)]
      : chartData.map((d) => d.yes);
    return computeDomain(vals);
  }, [chartData, showBothOutcomes]);

  const yTicks = useMemo(() => computeTicks(yDomain), [yDomain]);

  // ─── X-axis ticks (snapped to round boundaries) ─────────────
  const xTicks = useMemo(() => computeXTicks(chartData, period), [chartData, period]);
  const dataRangeMs = useMemo(() => {
    if (chartData.length < 2) return 0;
    return chartData[chartData.length - 1].time - chartData[0].time;
  }, [chartData]);

  // ─── Derived values ──────────────────────────────────────────
  const latestYes = chartData.length ? chartData[chartData.length - 1].yes : 0.5;
  const latestNo = chartData.length ? chartData[chartData.length - 1].no : 0.5;
  const isUp = chartData.length >= 2 && chartData[chartData.length - 1].yes >= chartData[0].yes;
  const lineColor = isUp ? colors.yes : colors.no;
  const isNew = createdAt ? Date.now() - new Date(createdAt).getTime() < 3 * 24 * 3600000 : false;

  // Compact mode keeps the chart slot painted even during the initial fetch
  // (renders a placeholder gray wave instead of a Skeleton block) so the
  // featured-cards carousel never flashes a blank gray rectangle. Full
  // (non-compact) chart still uses the Skeleton — that's behind a
  // toggle-able section where loading-state is expected.
  if (loading) {
    if (compact) {
      const placeholderColor = colors.muted ?? "rgb(148, 163, 184)";
      return (
        <div className={cn("h-16", className)} dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={LOADING_PLACEHOLDER_DATA} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`sg-loading-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={placeholderColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={placeholderColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["auto", "auto"]} hide />
              <Area
                type="monotone"
                dataKey="yes"
                stroke={placeholderColor}
                strokeWidth={1.5}
                fill={`url(#sg-loading-${marketId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );
    }
    return <Skeleton className={cn("h-72", "w-full rounded-lg", className)} />;
  }

  // ─── Compact sparkline ───────────────────────────────────────
  if (compact) {
    const vals = chartData.map((d) => d.yes);
    const [lo, hi] = computeDomain(vals);
    return (
      <div className={cn("h-16", className)} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`sg-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[lo, hi]} hide />
            <Area key={animationKey} type="stepAfter" dataKey="yes" stroke={lineColor} strokeWidth={1.5} fill={`url(#sg-${marketId})`} isAnimationActive={animate} animationDuration={600} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ─── Full chart ──────────────────────────────────────────────
  return (
    <div className={cn("space-y-3", className)}>
      {/* Legend */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors.yes }} />
          <span className="text-xs text-muted-custom">{t("yesLabelLower")}</span>
          <span className="text-sm font-bold text-text">{Math.round(latestYes * 100)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors.no }} />
          <span className="text-xs text-muted-custom">{t("noLabelLower")}</span>
          <span className={cn("text-sm font-bold", showBothOutcomes ? "text-text" : "text-muted-custom")}>
            {Math.round(latestNo * 100)}%
          </span>
        </div>
      </div>

      {/* Chart area — force LTR to prevent Recharts SVG flipping in RTL */}
      <div
        dir="ltr"
        className={cn(
          hideExtras ? "h-full" : (chartHeight ?? "h-[480px]"),
          "w-full [&_*:focus-visible]:outline-none [&_*:focus]:outline-none"
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`gy-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.yes} stopOpacity={0.08} />
                <stop offset="100%" stopColor={colors.yes} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`gn-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.no} stopOpacity={0.05} />
                <stop offset="100%" stopColor={colors.no} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke={colors.border}
              strokeOpacity={0.4}
              horizontal
              vertical={false}
            />

            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={xTicks}
              axisLine={false}
              tickLine={false}
              tick={{ fill: colors.dim, fontSize: 11 }}
              tickFormatter={(ts: number) => fmtAxisTick(ts, period, dataRangeMs)}
            />

            <YAxis
              domain={yDomain}
              ticks={yTicks}
              axisLine={false}
              tickLine={false}
              tick={{ fill: colors.dim, fontSize: 11 }}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              width={38}
              orientation="right"
            />

            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: colors.dim, strokeWidth: 0.5, strokeOpacity: 0.3 }}
              content={(props: any) => <ChartTooltip {...props} colors={colors} />}
            />

            {/* Yes line */}
            <Area
              type="stepAfter"
              dataKey="yes"
              name="yes"
              stroke={colors.yes}
              strokeWidth={1.5}
              fill={`url(#gy-${marketId})`}
              dot={(props: any) => (
                <GlowDot {...props} dataLength={chartData.length} color={colors.yes} />
              )}
              activeDot={{ r: 5, fill: colors.yes, stroke: colors.bg, strokeWidth: 2 }}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            />

            {/* No line — same shared Y-axis, shown when toggle is on */}
            {showBothOutcomes && (
              <Area
                type="stepAfter"
                dataKey="no"
                name="no"
                stroke={colors.no}
                strokeWidth={1.5}
                fill={`url(#gn-${marketId})`}
                dot={(props: any) => (
                  <GlowDot {...props} dataLength={chartData.length} color={colors.no} />
                )}
                activeDot={{ r: 4, fill: colors.no, stroke: colors.bg, strokeWidth: 2 }}
                isAnimationActive={animate}
                animationDuration={600}
                animationEasing="ease-out"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between">
        {!hideExtras ? (
          <div className="flex items-center gap-2">
            {createdAt && isNew && (
              <span className="text-[11px] font-medium text-yes">{t("newBadge")}</span>
            )}
            {createdAt && (
              <span className="text-[11px] text-muted-custom">{fmtCreatedDate(createdAt)}</span>
            )}
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3 relative">
          {availablePeriods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "text-xs font-medium transition-colors cursor-pointer px-1",
                period === p ? "text-text" : "text-dim hover:text-muted-custom"
              )}
            >
              {p}
            </button>
          ))}
          {/* Settings gear */}
          {!hideExtras && (
            <div ref={settingsRef} className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-dim hover:text-muted-custom transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              {showSettings && (
                <div className="absolute end-0 top-full mt-2 bg-elevated border border-border-custom rounded-lg p-3 z-20 min-w-[180px] shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-custom">{t("bothOutcomes")}</span>
                    <ToggleSwitch
                      enabled={showBothOutcomes}
                      onToggle={() => setShowBothOutcomes(!showBothOutcomes)}
                      size="sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
