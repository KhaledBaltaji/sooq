"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type AutoscaleInfo,
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
  // Mig 369: durations are 5m + 1h. 5m uses 15s buckets, 1h uses 60s buckets.
  // Older 15m/24h enum values can still appear in historical markets but new
  // markets are limited to 5m + 1h.
  const resolvedBucket =
    bucketSeconds ?? (duration === "1h" ? 60 : 15);
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
  // Track whether the initial setData() bulk-load has run for the current
  // series. After the first load, every 30s history refetch is applied
  // INCREMENTALLY via series.update() per bar — never another setData,
  // because setData wipes the live-tail's trailing bar and the user sees
  // the candle vanish for ~50-500ms until the next live tick rebuilds it.
  // Reset whenever the series swaps (chartType toggle).
  const hasInitialDataRef = useRef(false);
  // Group C: live-tail update path is RAF-coalesced. Binance bookTicker
  // emits 200–500 events/sec; we don't want to call series.update() per
  // event (browsers paint at most 60 fps anyway). Latest pending bar is
  // stored here and a single requestAnimationFrame pump applies it.
  const pendingBarRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Group C: EMA on the displayed Y-axis priceRange so it glides toward
  // its target instead of snapping each redraw. State is stored as the
  // most recent {minValue,maxValue} we returned from autoscaleInfoProvider.
  const yRangeEmaRef = useRef<{ minValue: number; maxValue: number } | null>(null);
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
        // Group C: bumped 0.15 → 0.22. Combined with the per-series
        // autoscaleInfoProvider below (min-range floor + EMA), this gives
        // the chart breathing room so micro-noise doesn't visually
        // amplify into chart-spanning swings.
        scaleMargins: { top: 0.22, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        // Show seconds at deep zoom — at 15s buckets, ticks within the
        // same minute would all collide as "21:01" without this. The
        // tickMarkFormatter below switches to HH:MM:SS when
        // lightweight-charts asks for second-precision (TickMarkType=4),
        // and stays at HH:MM at the default zoom.
        secondsVisible: true,
        // Bigger barSpacing makes candles read as chunky bars instead of
        // thin lines. 8px (default 6) matches the Polymarket feel for our
        // 15s buckets on a 5m market.
        barSpacing: 8,
        // No empty headroom on the right (W11 — Khaled's call): the
        // chart's right edge IS the latest data point. fixRightEdge
        // below blocks forward-drag entirely. Users can only pan
        // backward into history.
        rightOffset: 0,
        // Lock the right edge so the user can't drag forward into
        // empty future space. Backward pan into history still works.
        fixRightEdge: true,
        // Render axis labels in the user's local timezone so they line
        // up with the page header (e.g. "9:00 PM" instead of UTC
        // "21:00"). The 2nd arg is a TickMarkType enum:
        //   3 = Time (HH:MM) — default zoom on intraday views
        //   4 = TimeWithSeconds (HH:MM:SS) — deep zoom inside a minute
        // We pass through to the right Intl.DateTimeFormat options so
        // duplicate "21:01" labels at 15s granularity become 21:01:00,
        // 21:01:15, 21:01:30, 21:01:45 — distinct.
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          const d = new Date(time * 1000);
          if (tickMarkType >= 4) {
            return d.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
          }
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

    // Group C: autoscaleInfoProvider — runs on every redraw, lets us
    // override the Y-axis range without disabling auto-scale.
    //   1. Hard floor: visible range ≥ 0.25% of mid (~$200 at $80k BTC).
    //      Stops the chart ever zooming so tight that a $3 wobble looks
    //      like a 30%-of-viewport swing on a calm market.
    //   2. EMA on the range itself: instead of letting auto-scale snap
    //      to a new min/max each redraw, we glide displayed range toward
    //      the target with a 0.85 alpha. The chart "breathes" instead of
    //      jumping — same effect TradingView and Polymarket use.
    // Reset on mount/series-swap is handled below by clearing the ref.
    yRangeEmaRef.current = null;
    const Y_FLOOR_FRAC = 0.0025; // 0.25% of mid
    const Y_FLOOR_ABS = 0.5; // never less than $0.50 visible
    // 0.15 = 15% toward the natural target each redraw. With 60fps redraws
    // the visible range settles in ~300ms — slow enough that the user reads
    // it as a glide between zoom levels, not a snap. Was 0.85 (basically
    // no smoothing — settled in ~50ms). Group C+ cleanup tuning.
    const Y_EMA_ALPHA = 0.15;
    const enforceMinRangeAndSmooth = (
      orig: () => AutoscaleInfo | null,
    ): AutoscaleInfo | null => {
      const info = orig();
      if (!info || !info.priceRange) return info;
      const { minValue, maxValue } = info.priceRange;
      const mid = (minValue + maxValue) / 2;
      const targetRange = Math.max(
        maxValue - minValue,
        mid * Y_FLOOR_FRAC,
        Y_FLOOR_ABS,
      );
      const half = targetRange / 2;
      const targetMin = mid - half;
      const targetMax = mid + half;
      const prev = yRangeEmaRef.current;
      const nextMin = prev
        ? Y_EMA_ALPHA * targetMin + (1 - Y_EMA_ALPHA) * prev.minValue
        : targetMin;
      const nextMax = prev
        ? Y_EMA_ALPHA * targetMax + (1 - Y_EMA_ALPHA) * prev.maxValue
        : targetMax;
      yRangeEmaRef.current = { minValue: nextMin, maxValue: nextMax };
      return {
        ...info,
        priceRange: {
          minValue: nextMin,
          maxValue: nextMax,
        },
      };
    };

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
        autoscaleInfoProvider: enforceMinRangeAndSmooth,
      });
    } else {
      series = chart.addSeries(AreaSeries, {
        // Neutral gray on initial paint — the recolor effect below
        // flips to green/red once the live oracle price (or last bar
        // close for closed markets) is known. Avoids a green flash on
        // markets that should ultimately render red.
        lineColor: "rgb(148, 163, 184)",
        topColor: "rgba(148, 163, 184, 0.18)",
        bottomColor: "rgba(148, 163, 184, 0.0)",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        lastValueVisible: false,
        priceLineVisible: false,
        // Hide the crosshair marker — lightweight-charts otherwise draws
        // a small filled circle on the line at the cursor's x whenever
        // the user hovers over the chart, which collided visually with
        // our HTML pulsing dot at the live edge (looked like two dots).
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: enforceMinRangeAndSmooth,
      });
    }

    seriesRef.current = series;
    // Force the next data effect to refit + bulk-load + repaint the strike
    // line on the new series instance.
    hasFitContentRef.current = false;
    hasInitialDataRef.current = false;
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

  // Push history into the series.
  //
  // Cleanup: on the FIRST paint we bulk-load via setData(). On every
  // subsequent 30s refetch we apply each historical bar via per-bar
  // series.update() AND skip the trailing bar entirely — the live-tail
  // RAF is mutating that bar in place from oracle ticks, and a fresh
  // setData would wipe its in-progress state and the user would see
  // the trailing candle vanish for 50-500ms every refresh until the
  // next tick rebuilt it. The server's view of the trailing bucket is
  // strictly less complete than the live-tail's view (oracle ticks
  // arrive faster than the 30s history refetch), so dropping it is
  // strictly better.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !mounted) return;
    if (candles.length === 0) {
      // setData(...) is structurally compatible across both series types
      // for the empty case (typed as never[] would be fine but `any` keeps
      // both branches happy without a type assertion gymnastics).
      (series as ISeriesApi<"Candlestick">).setData([]);
      lastBarRef.current = null;
      hasInitialDataRef.current = false;
      return;
    }
    const data: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (!hasInitialDataRef.current) {
      // First paint: bulk-load everything.
      if (chartType === "candle") {
        (series as ISeriesApi<"Candlestick">).setData(data);
      } else {
        (series as ISeriesApi<"Area">).setData(
          data.map((d) => ({ time: d.time, value: d.close })),
        );
      }
      lastBarRef.current = data[data.length - 1] ?? null;
      hasInitialDataRef.current = true;
    } else {
      // Subsequent refetches: only push bars whose time is STRICTLY
      // GREATER than what's already on the chart. lightweight-charts'
      // series.update() rejects (throws "Cannot update oldest data")
      // any time <= the current last bar — closed historical bars are
      // immutable once they roll over, which is correct for our use
      // case (a closed 15s/60s bucket's OHLC is final). This loop
      // therefore only ever appends NEW closed buckets that rolled
      // over since the last 30s refetch — typically 0–2 of them.
      // The trailing live bucket (whose time matches lastBarRef) is
      // never touched here; live-tail owns it.
      const currentLast = lastBarRef.current;
      const currentLastTime = currentLast ? (currentLast.time as number) : -Infinity;
      let appended = 0;
      for (let i = 0; i < data.length; i++) {
        const bar = data[i];
        if ((bar.time as number) <= currentLastTime) continue;
        if (chartType === "candle") {
          (series as ISeriesApi<"Candlestick">).update(bar);
        } else {
          (series as ISeriesApi<"Area">).update({ time: bar.time, value: bar.close });
        }
        appended++;
      }
      // Advance lastBarRef if we appended new closed buckets and the
      // live-tail hasn't yet caught up (e.g., oracle stale or pre-open
      // window). This keeps the chart's "trailing bar" reference in
      // sync with what's actually rendered.
      if (appended > 0) {
        const last = data[data.length - 1] ?? null;
        if (last && (currentLast == null || (last.time as number) > currentLastTime)) {
          lastBarRef.current = last;
        }
      }
    }
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
  // Floor tickTime to resolvedBucket so ticks fold into the same N-second
  // candle until the bucket boundary rolls over.
  //
  // Group C: RAF-coalesced. With Binance @bookTicker pushing 200–500
  // events/sec, calling series.update() per tick is wasteful — browsers
  // paint at 60 fps max and lightweight-charts re-runs auto-scale on
  // every update. We stash the latest desired bar in pendingBarRef and
  // pump it through requestAnimationFrame, so series.update() runs at
  // most once per frame with the freshest data. Visually identical;
  // dramatically less CPU + less Y-axis snapping.
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

    // Group C+ cleanup: only extend the trailing candle's high / low
    // when a tick moves the wick by a meaningful amount (>=0.05% of
    // price, ~$40 at $80k BTC). Without this gate, every $0.01 mid
    // wobble during a flat bucket inflates the wick over time and
    // the wick never shrinks within the bucket — so the visible Y
    // range grows monotonically inside a 15s/60s bucket and snaps
    // back tight when the bucket boundary rolls. Visible as a periodic
    // jolt every bucket. Real moves still extend H/L cleanly.
    const NOISE_FLOOR = last.close * 0.0005;
    const next: CandlestickData<UTCTimestamp> =
      bucketed === last.time
        ? {
            time: last.time,
            open: last.open,
            high: tickPrice > last.high + NOISE_FLOOR ? tickPrice : last.high,
            low: tickPrice < last.low - NOISE_FLOOR ? tickPrice : last.low,
            close: tickPrice,
          }
        : {
            time: bucketed,
            open: last.close,
            high: tickPrice > last.close + NOISE_FLOOR ? tickPrice : last.close,
            low: tickPrice < last.close - NOISE_FLOOR ? tickPrice : last.close,
            close: tickPrice,
          };

    // Stash latest pending bar; the RAF pump applies at most once per
    // animation frame.
    pendingBarRef.current = next;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingBarRef.current;
        if (!pending) return;
        pendingBarRef.current = null;
        const live = seriesRef.current;
        if (!live) return;
        if (chartType === "candle") {
          (live as ISeriesApi<"Candlestick">).update(pending);
        } else {
          (live as ISeriesApi<"Area">).update({
            time: pending.time,
            value: pending.close,
          });
        }
        lastBarRef.current = pending;

        // Group C+ cleanup: recompute dot position ONCE per data tick,
        // right after the series update lands. This replaces the prior
        // continuous 60fps RAF loop. CSS transition on the dot's
        // transform handles the visual glide between data ticks.
        const chart = chartRef.current;
        if (chartType === "line" && chart) {
          const livePrice = pending.close;
          const y = live.priceToCoordinate(livePrice);
          const tx = chart.timeScale().timeToCoordinate(pending.time);
          const x =
            typeof tx === "number" && Number.isFinite(tx)
              ? tx
              : chart.timeScale().width();
          if (typeof y === "number" && Number.isFinite(y)) {
            const isOver = livePrice >= strikePrice;
            setLiveDot((prev) => {
              if (
                prev &&
                Math.abs(prev.x - x) < 0.5 &&
                Math.abs(prev.y - y) < 0.5 &&
                prev.isOver === isOver
              ) {
                return prev;
              }
              return { x, y, isOver };
            });
          }
        }

        // Auto-follow (W11): if the new bucket's time has drifted past
        // the chart's visible range, snap back to real-time. Skipped
        // when last.time is still inside the visible range — that would
        // yank the chart away from a user who panned into history.
        if (chart) {
          const visible = chart.timeScale().getVisibleRange();
          if (visible && (pending.time as number) > (visible.to as number)) {
            chart.timeScale().scrollToRealTime();
          }
        }
      });
    }
  }, [oracle, isStale, mounted, resolvedBucket, chartType, isLive, strikePrice]);

  // Cancel any in-flight RAF on unmount so we don't update a torn-down series.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingBarRef.current = null;
    };
  }, []);

  // Group C+ cleanup: dot position is now updated inside the live-tail
  // RAF callback above (once per data tick, not 60fps). This effect is
  // ONLY responsible for:
  //   1. The Target line's pixel-Y label (strike price coord).
  //   2. Recomputing the dot when the chart's price scale changes for
  //      reasons OTHER than a new tick (e.g. user pans/zooms or the
  //      window resizes — both shift priceToCoordinate's output).
  // 250ms poll is plenty for both: Target label rarely moves, and pan/
  // zoom is human-driven, not high-frequency.
  useEffect(() => {
    if (!mounted) {
      setLiveDot(null);
      return;
    }
    if (chartType !== "line") {
      // Candle mode — clear any stale dot state from a prior toggle.
      setLiveDot(null);
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series) return;

      const ty = series.priceToCoordinate(strikePrice);
      if (typeof ty === "number" && Number.isFinite(ty)) {
        setTargetY((prev) => (prev !== null && Math.abs(prev - ty) < 0.5 ? prev : ty));
      }

      if (chartType === "line" && chart) {
        const last = lastBarRef.current;
        if (last) {
          const livePrice = last.close;
          const y = series.priceToCoordinate(livePrice);
          const tx = chart.timeScale().timeToCoordinate(last.time);
          const x =
            typeof tx === "number" && Number.isFinite(tx)
              ? tx
              : chart.timeScale().width();
          if (typeof y === "number" && Number.isFinite(y)) {
            const isOver = livePrice >= strikePrice;
            setLiveDot((prev) => {
              if (
                prev &&
                Math.abs(prev.x - x) < 0.5 &&
                Math.abs(prev.y - y) < 0.5 &&
                prev.isOver === isOver
              ) {
                return prev;
              }
              return { x, y, isOver };
            });
          }
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chartType, mounted, strikePrice]);

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
    // overflow-hidden is the safety-net layer (W11): even if the live-tail
    // dot's computed pixel coords accidentally exceed the canvas width, the
    // dot is clipped to the chart bounds instead of escaping into the page
    // background. Combines with explicit clamping in the dot tick effect
    // below + the auto-follow in the live-tail effect.
    <div
      className={cn("relative w-full overflow-hidden", className)}
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
          Group C+ cleanup: position is set inline as a CSS transform with
          a transition. No spring physics — the browser linearly tweens
          between two stable target positions. No init-from-0 ghost (first
          render places the dot exactly where it should be, then transitions
          on subsequent updates). The pulse/ping ring + glow are unchanged. */}
      {chartType === "line" && liveDot && showCanvas && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 will-change-transform"
          style={{
            transform: `translate3d(${liveDot.x}px, ${liveDot.y}px, 0) translate(-50%, -50%)`,
            transition: "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)",
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
