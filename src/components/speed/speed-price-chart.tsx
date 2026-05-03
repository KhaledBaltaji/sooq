"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSpeedPriceHistory } from "@/hooks/use-speed-price-history";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import type { SpeedAsset, SpeedDuration } from "@/types/database";

export type SpeedChartType = "candle" | "line";
export const SPEED_CHART_TYPE_KEY = "speed-chart-type";

export function readSpeedChartType(): SpeedChartType {
  if (typeof window === "undefined") return "candle";
  try {
    const v = window.localStorage.getItem(SPEED_CHART_TYPE_KEY);
    return v === "line" ? "line" : "candle";
  } catch {
    return "candle";
  }
}

interface SpeedPriceChartProps {
  asset: SpeedAsset;
  strikePrice: number;
  opensAt: string;
  closesAt: string;
  className?: string;
  height?: number;
  /**
   * Candle granularity in seconds. If unset, picks a per-duration default:
   * 15s for 5m markets, 60s for 1h. Settlement still uses 1s ticks server-
   * side; this is purely a display concern.
   */
  bucketSeconds?: number;
  /**
   * Per-duration display tweaks (default-zoom buffer, candle bucket size).
   * Vertical resize was removed — chart height is fixed by the `height` prop.
   */
  duration?: SpeedDuration;
  /**
   * Chart type — controlled from the parent so the toggle UI can live
   * outside the chart (e.g. on the same row as window pills).
   */
  chartType?: SpeedChartType;
  /**
   * Market status. When this is anything other than "open" the chart
   * freezes: live-tail oracle ticks stop appending past close, the
   * pulsing dot snaps to the last historical bar instead of tracking
   * the live oracle, and recoloring uses the final outcome rather than
   * the still-ticking spot price. Without this the chart kept growing
   * past closes_at and the dot drifted off the line.
   */
  status?: "open" | "resolving" | "resolved" | "voided";
}

/**
 * Candlestick price chart for a speed market — TradingView lightweight-charts.
 *
 * - Loads OHLC history via `useSpeedPriceHistory` (mig 334 RPC, refreshed 30s)
 * - Subscribes to live oracle ticks via `useSpeedOracleLatest` and updates the
 *   trailing candle's high/low/close in-place between server refreshes
 * - Strike rendered as a dashed red horizontal price line via createPriceLine
 * - Auto-flips candle color from design tokens (success / destructive)
 * - Cleans up the chart on unmount
 */
export function SpeedPriceChart({
  asset,
  strikePrice,
  opensAt,
  closesAt,
  className,
  height = 360,
  // Bucket size tuned per duration for visual clarity (Polymarket-style
  // chunky candles instead of thin 1Hz noise). Defaults if caller doesn't
  // override: 15s for 5m markets (~144 candles for 36min window), 60s for
  // 1h (~91 candles for 91min window). Settlement still reads 1s ticks
  // server-side; this is purely display.
  bucketSeconds,
  duration,
  chartType: chartTypeProp,
  status,
}: SpeedPriceChartProps) {
  const chartType: SpeedChartType = chartTypeProp ?? "candle";
  // Anything past "open" means the market has closed (resolving / resolved /
  // voided). Used by every effect that touches the live oracle so the
  // chart visually freezes at closes_at instead of trailing the still-
  // ticking spot.
  const isLive = !status || status === "open";
  // Both candle and line modes use the same bucket size — 15s for 5m, 60s
  // for 1h. Previously line mode requested 1s buckets for "Polymarket
  // smoothness", but the get_speed_klines RPC's fast path returns raw
  // klines as-is at 1s, exposing the underlying sparseness in
  // speed_oracle_klines (gaps from oracle worker hiccups). Candle mode's
  // aggregation hides those gaps, so the two views looked like different
  // charts on the same market. Aligning bucket sizes makes both views
  // honest about the actual data density.
  // 1h duration was dropped post-strip; 5m/15m get 15s buckets, 24h gets 60s.
  const resolvedBucket =
    bucketSeconds ?? (duration === "24h" ? 60 : 15);
  const t = useTranslations("speed");
  const { candles, loading, error } = useSpeedPriceHistory(
    asset,
    opensAt,
    closesAt,
    resolvedBucket,
  );
  const { oracle, isStale } = useSpeedOracleLatest(asset);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // seriesRef holds whichever series is currently active (Candlestick or
  // Area). The data-load + live-tail effects branch on chartType to push
  // the right shape into it. strikeLineRef tracks the priceLine attached
  // to whichever series is current; we re-create it after a series swap.
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const strikeLineRef = useRef<IPriceLine | null>(null);
  const lastBarRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  // Track whether we've fit content once. Subsequent history refreshes
  // (every 30s) must NOT call fitContent again — that would reset the
  // user's pan/zoom on every refresh and feel jarring.
  const hasFitContentRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  // Live-tail pulsing dot position. Only used in line mode — recomputed
  // at 10Hz from the latest bar's time + the live oracle price.
  const [liveDot, setLiveDot] = useState<{ x: number; y: number; isOver: boolean } | null>(null);
  // Target line's pixel Y for the HTML label overlay. Polled at 10Hz via
  // priceToCoordinate(strikePrice). Drives a separate label rendered in
  // the JSX since lightweight-charts' built-in axisLabel + title rendering
  // either duplicates or completely hides the text depending on version.
  const [targetY, setTargetY] = useState<number | null>(null);

  // Mount chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(148, 163, 184, 0.7)",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "DM Sans", sans-serif',
        fontSize: 11,
      },
      // Polymarket-style minimal grid: only horizontal price lines, very
      // subtle. Vertical lines clutter without adding info on a candle chart.
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(148, 163, 184, 0.06)" },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        // Hide seconds at the default zoom — too noisy. Lightweight-charts
        // reveals them automatically when the user zooms in past the bucket
        // size, so deep-zoom views still show second-precision.
        secondsVisible: false,
        // Bigger barSpacing makes candles read as chunky bars instead of
        // thin lines. 8px (default 6) matches the Polymarket feel for our
        // 15s buckets on a 5m market.
        barSpacing: 8,
        // 20 bars of empty room to the right of the latest data so the
        // user can drag the chart forward (pan right) to see "future"
        // empty space and reposition the line on the left half. Default
        // is 0 which pins the right edge to the latest bar and makes
        // forward-drag impossible.
        rightOffset: 20,
        // Keep the default `shiftVisibleRangeOnNewBar: true` so when a
        // new bucket rolls, the visible range moves with it — otherwise
        // last.time advances past the right edge and the dot drifts off
        // the line into empty space. With rightOffset:20 above, the user
        // still has 20 bars of headroom and can drag forward; we just
        // don't freeze the auto-follow.
        // Render axis labels and crosshair tooltips in the user's local
        // timezone so they line up with the page header (e.g. "6:00 PM"
        // instead of UTC "15:00") which uses the browser's locale formatter.
        // tickMarkFormatter receives a UTC epoch in seconds; we convert.
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        },
      },
      localization: {
        timeFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return d.toLocaleString(undefined, {
            month: "short",
            day: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        },
      },
      // Native pan/zoom on the chart canvas itself.
      //
      // mouseWheel is DISABLED on both handlers: when it's enabled,
      // scrolling the page with the wheel captures the event when the
      // cursor is over the chart, blocking vertical page scroll. That
      // breaks the page on a chart that takes up most of the viewport.
      //
      // Kept enabled:
      //   - pressedMouseMove: drag the chart canvas left/right to pan
      //   - horzTouchDrag: same for touch
      //   - axisPressedMouseMove on time: drag the time-axis labels to zoom
      //   - pinch: trackpad / touchscreen pinch-zoom works normally
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: false },
        mouseWheel: false,
        pinch: true,
      },
    });

    chartRef.current = chart;
    setMounted(true);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      strikeLineRef.current = null;
      lastBarRef.current = null;
    };
  }, []);

  // Create / replace the data series based on chartType. Lightweight-charts
  // can't morph one series type into another, so when the user toggles we
  // tear down the old series (which also drops its priceLines) and add the
  // new one. The chart instance + pan/zoom state are preserved.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !mounted) return;

    let series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">;
    if (chartType === "candle") {
      series = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderUpColor: "#26a69a",
        borderDownColor: "#ef5350",
        borderVisible: true,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        // Hide right-axis live-price label + dashed line; the page header
        // shows live, the target priceLine owns the right-axis label.
        lastValueVisible: false,
        priceLineVisible: false,
      });
    } else {
      series = chart.addSeries(AreaSeries, {
        lineColor: "#26a69a",
        topColor: "rgba(38, 166, 154, 0.18)",
        bottomColor: "rgba(38, 166, 154, 0.0)",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    seriesRef.current = series;
    // Force the next data effect to refit + repaint the strike line on
    // the new series instance.
    hasFitContentRef.current = false;
    strikeLineRef.current = null;
    lastBarRef.current = null;

    return () => {
      // Clean up this specific series. chart.removeSeries() also drops
      // any priceLines that were attached to it.
      try {
        chart.removeSeries(series);
      } catch {
        // chart may already be torn down by the mount-once effect's
        // cleanup; ignore.
      }
      if (seriesRef.current === series) seriesRef.current = null;
    };
  }, [chartType, mounted]);

  // Push history into the series
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !mounted) return;
    if (candles.length === 0) {
      // setData(...) is structurally compatible across both series types
      // for the empty case (typed as never[] would be fine but `any` keeps
      // both branches happy without a type assertion gymnastics).
      (series as ISeriesApi<"Candlestick">).setData([]);
      lastBarRef.current = null;
      return;
    }
    const data: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    if (chartType === "candle") {
      (series as ISeriesApi<"Candlestick">).setData(data);
    } else {
      // Area series: feed close-price as a single line value
      (series as ISeriesApi<"Area">).setData(
        data.map((d) => ({ time: d.time, value: d.close })),
      );
    }
    lastBarRef.current = data[data.length - 1] ?? null;
    // First-paint focus: zoom to the market window plus a small pre-market
    // buffer instead of fitting all loaded candles. The full 30min of pre-
    // market history is still LOADED — the user can drag-pan left to see
    // it — but the default view focuses on what matters: the current
    // market's window. For 5m markets that's 6.5min visible, for 1h ~66min.
    if (!hasFitContentRef.current) {
      // Default zoom: focus on the market window with a tight pre/post
      // buffer (matches user's preferred screenshot — ~5m of pre-market
      // context for a 5m market, scaling up for longer durations). The
      // full ~30min of loaded history is still pannable left.
      const opensTs = Math.floor(new Date(opensAt).getTime() / 1000);
      const closesTs = Math.floor(new Date(closesAt).getTime() / 1000);
      const windowSec = closesTs - opensTs;
      // 1× window of pre-market context, 0.4× post-market — tight default.
      const preBuffer = Math.max(60, Math.round(windowSec));
      const postBuffer = Math.max(30, Math.round(windowSec * 0.4));
      const fromTs = (opensTs - preBuffer) as UTCTimestamp;
      const toTs = (closesTs + postBuffer) as UTCTimestamp;
      requestAnimationFrame(() => {
        chartRef.current?.timeScale().setVisibleRange({ from: fromTs, to: toTs });
      });
      hasFitContentRef.current = true;
    }
  }, [candles, mounted, opensAt, closesAt, duration, chartType]);

  // Reset the fit-content latch when the market changes (different opensAt
  // means a new market — refit so the user sees the new strike + window).
  useEffect(() => {
    hasFitContentRef.current = false;
  }, [opensAt, closesAt]);

  // Strike price line
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !mounted) return;
    if (strikeLineRef.current) {
      series.removePriceLine(strikeLineRef.current);
      strikeLineRef.current = null;
    }
    strikeLineRef.current = series.createPriceLine({
      price: strikePrice,
      // Slate gray, dotted, 2px — clearly visible on the chart background
      // without dominating. The "Target $X" label is a separate HTML
      // overlay (axisLabelVisible: false here disables the chart-rendered
      // label which had inconsistent rendering between lightweight-charts
      // versions — sometimes duplicating, sometimes hidden).
      color: "#64748b",
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
    });
  }, [strikePrice, mounted, chartType]);

  // Live tail: update last candle's high/low/close as oracle ticks arrive.
  // Floor tickTime to resolvedBucket so 1Hz ticks fold into the same N-second
  // candle until the bucket boundary rolls over. Without this, every 1s tick
  // would create a new sub-bucket candle on top of the N-second history,
  // producing a visual mismatch between historical and live regions.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !mounted || !oracle || isStale) return;
    // Freeze for closed markets — the line should end at closes_at, not
    // keep growing forever as the oracle continues ticking.
    if (!isLive) return;
    const last = lastBarRef.current;
    if (!last) return;
    const tickPrice = Number(oracle.price);
    const tickEpoch = Math.floor(new Date(oracle.received_at).getTime() / 1000);
    const bucketed = (Math.floor(tickEpoch / resolvedBucket) * resolvedBucket) as UTCTimestamp;
    if (bucketed < last.time) return;

    const next: CandlestickData<UTCTimestamp> =
      bucketed === last.time
        ? {
            time: last.time,
            open: last.open,
            high: Math.max(last.high, tickPrice),
            low: Math.min(last.low, tickPrice),
            close: tickPrice,
          }
        : {
            time: bucketed,
            open: last.close,
            high: Math.max(last.close, tickPrice),
            low: Math.min(last.close, tickPrice),
            close: tickPrice,
          };
    if (chartType === "candle") {
      (series as ISeriesApi<"Candlestick">).update(next);
    } else {
      (series as ISeriesApi<"Area">).update({ time: next.time, value: tickPrice });
    }
    lastBarRef.current = next;
  }, [oracle, isStale, mounted, resolvedBucket, chartType, isLive]);

  // Track the target line's pixel Y so we can render an HTML label
  // overlay at that position. Both modes need this — the dotted line is
  // drawn by the chart but the label text is HTML.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const series = seriesRef.current;
      if (!series) return;
      const y = series.priceToCoordinate(strikePrice);
      if (typeof y === "number" && Number.isFinite(y)) {
        setTargetY((prev) => (prev !== null && Math.abs(prev - y) < 0.5 ? prev : y));
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mounted, strikePrice, chartType]);

  // Live-tail pulsing dot — line mode only. Polls priceToCoordinate(live)
  // and timeToCoordinate(latestBar) at 10Hz to position an HTML overlay at
  // the right edge of the line. Polling because lightweight-charts has no
  // single "price/time scale changed" event; 10Hz is cheap.
  useEffect(() => {
    if (chartType !== "line" || !mounted) {
      setLiveDot(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const series = seriesRef.current;
      const chart = chartRef.current;
      const last = lastBarRef.current;
      if (!series || !chart || !last) return;
      // Closed markets snap the dot to the last bar's close so it sits on
      // the line endpoint, not above/below it tracking the still-ticking
      // oracle. Live markets follow the oracle as before.
      const livePrice = isLive && oracle ? Number(oracle.price) : last.close;
      const y = series.priceToCoordinate(livePrice);
      // X = the pixel for last.time, which is always inside the chart's
      // data range so timeToCoordinate returns a valid number. The dot
      // sits at the rightmost point of the rendered line — for live
      // markets it'll "jump" 8px every 15s when a new bucket rolls,
      // which is fine and predictable. (Earlier projection-based
      // attempts pushed the dot outside the chart bounds.)
      const x = chart.timeScale().timeToCoordinate(last.time);
      if (
        typeof x !== "number" || !Number.isFinite(x) ||
        typeof y !== "number" || !Number.isFinite(y)
      ) {
        return;
      }
      const isOver = livePrice >= strikePrice;
      setLiveDot((prev) => {
        if (prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 && prev.isOver === isOver) {
          return prev;
        }
        return { x, y, isOver };
      });
    };
    tick();
    const id = setInterval(tick, 100);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chartType, mounted, oracle, strikePrice, isLive]);

  // Recolor the AreaSeries based on live vs target. Green palette when
  // live >= target, red palette when below. Only runs in line mode —
  // candle bodies already encode their own direction.
  useEffect(() => {
    if (chartType !== "line") return;
    const series = seriesRef.current as ISeriesApi<"Area"> | null;
    if (!series) return;
    // Closed markets recolor against the chart's last historical close
    // (the actual outcome shape) rather than the still-ticking spot. If
    // the market is open, follow the oracle.
    const last = lastBarRef.current;
    const livePrice = isLive && oracle
      ? Number(oracle.price)
      : last?.close ?? null;
    if (livePrice == null) return;
    const isOver = livePrice >= strikePrice;
    series.applyOptions(
      isOver
        ? {
            lineColor: "#26a69a",
            topColor: "rgba(38, 166, 154, 0.18)",
            bottomColor: "rgba(38, 166, 154, 0.0)",
          }
        : {
            lineColor: "#ef5350",
            topColor: "rgba(239, 83, 80, 0.18)",
            bottomColor: "rgba(239, 83, 80, 0.0)",
          },
    );
  }, [oracle, strikePrice, chartType, isLive]);

  // The container div MUST be rendered on first paint so the mount-once
  // useEffect at line 62 can read containerRef.current and call createChart.
  // Earlier shape returned different JSX trees per state (loading/error/empty/
  // success) which meant the ref div didn't exist during the loading state, the
  // effect early-returned, and never re-ran with [] deps — chart never drew.
  const isEmpty = !loading && !error && candles.length === 0;
  const showCanvas = !loading && !error && candles.length > 0;
  const lastClose = lastBarRef.current?.close ?? null;
  const ariaLabel = error
    ? "Price chart unavailable"
    : showCanvas
      ? `${asset} price chart, ${candles.length} candles, current $${
          lastClose?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"
        }, strike $${strikePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "Price chart loading";

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {/* Target Price label overlay. Anchored to the LEFT edge of the
          chart so it never collides with the live-tail pulsing dot at
          the right edge. The dotted line itself is still drawn by the
          chart's createPriceLine. */}
      {showCanvas && targetY !== null && (
        <div
          className="pointer-events-none absolute left-3 z-10 whitespace-nowrap rounded-md bg-bg/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-custom ring-1 ring-border-custom backdrop-blur-sm"
          style={{
            top: targetY,
            transform: "translateY(-50%)",
          }}
          aria-hidden
        >
          Target ${strikePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}

      {/* Live-tail pulsing dot at the end of the line (line mode only).
          Two stacked elements: a center dot (solid) and an outer ring
          that pulses outward via CSS keyframes. Color matches the line
          (green when live > target, red when below). pointer-events-none
          so chart pan/zoom isn't blocked. */}
      {chartType === "line" && liveDot && showCanvas && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: liveDot.x,
            top: liveDot.y,
            transform: "translate(-50%, -50%)",
          }}
          aria-hidden
        >
          <span
            className="absolute inset-0 -m-1 animate-ping rounded-full opacity-60"
            style={{
              background: liveDot.isOver ? "#26a69a" : "#ef5350",
              width: 16,
              height: 16,
            }}
          />
          <span
            className="block rounded-full ring-2 ring-white"
            style={{
              background: liveDot.isOver ? "#26a69a" : "#ef5350",
              width: 8,
              height: 8,
              boxShadow: liveDot.isOver
                ? "0 0 12px 2px rgba(38, 166, 154, 0.7)"
                : "0 0 12px 2px rgba(239, 83, 80, 0.7)",
            }}
          />
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 px-4 pointer-events-none">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-bg text-xs text-muted-custom pointer-events-none">
          Chart unavailable
        </div>
      )}

      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-bg text-xs pointer-events-none">
          <div className="h-1 w-32 animate-pulse rounded-full bg-muted-custom/30" />
          <span className="text-muted-custom">{t("loadingChart")}</span>
        </div>
      )}

      {showCanvas && isStale && (
        <div className="absolute right-3 top-2 z-10 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning ring-1 ring-warning/30">
          {t("reconnecting")}
        </div>
      )}
    </div>
  );
}
