"use client";

import { useEffect, useRef, memo } from "react";
import { createChart, AreaSeries, LineType, ColorType } from "lightweight-charts";
import type { IChartApi, ISeriesApi, AreaData, Time } from "lightweight-charts";
import type { PricePoint } from "@/hooks/use-price-history";
import { useThemeColors } from "@/hooks/use-theme-colors";
import { cn } from "@/lib/utils";

export type ChartSide = "yes" | "no" | "both";

interface TradingViewChartProps {
  data: PricePoint[];
  loading?: boolean;
  className?: string;
  side?: ChartSide;
  /** Prevent scrolling before this date (ISO string) */
  createdAt?: string;
}

function toChartData(data: PricePoint[], field: "yes" | "no" = "yes"): AreaData<Time>[] {
  // Sort by time asc and deduplicate (lightweight-charts requires strictly ascending times)
  const sorted = [...data].sort((a, b) => a.time - b.time);
  const result: AreaData<Time>[] = [];
  let prevTime = -1;
  for (const p of sorted) {
    const t = Math.floor(p.time / 1000);
    if (t <= prevTime) continue; // skip duplicates / out-of-order
    result.push({ time: t as Time, value: p[field] });
    prevTime = t;
  }
  return result;
}

function TradingViewChartInner({ data, loading, className, side = "yes", createdAt }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const yesSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const noSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const colors = useThemeColors();

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: colors.border, style: 3 },
      },
      crosshair: {
        vertLine: { color: colors.dim, width: 1, style: 2, labelBackgroundColor: colors.elevated },
        horzLine: { color: colors.dim, width: 1, style: 2, labelBackgroundColor: colors.elevated },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: false },
        pinch: true,
        mouseWheel: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    const yesSeries = chart.addSeries(AreaSeries, {
      lineColor: colors.yes,
      lineWidth: 2,
      lineType: LineType.WithSteps,
      topColor: `${colors.yes}14`,
      bottomColor: `${colors.yes}00`,
      crosshairMarkerBackgroundColor: colors.yes,
      crosshairMarkerBorderColor: colors.bg,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerRadius: 5,
      priceFormat: {
        type: "custom" as const,
        formatter: (price: number) => `${(price * 100).toFixed(1)}%`,
      },
    });

    const noSeries = chart.addSeries(AreaSeries, {
      lineColor: colors.no,
      lineWidth: 2,
      lineType: LineType.WithSteps,
      topColor: `${colors.no}14`,
      bottomColor: `${colors.no}00`,
      crosshairMarkerBackgroundColor: colors.no,
      crosshairMarkerBorderColor: colors.bg,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerRadius: 5,
      priceFormat: {
        type: "custom" as const,
        formatter: (price: number) => `${(price * 100).toFixed(1)}%`,
      },
      visible: false, // hidden by default
    });

    chartRef.current = chart;
    yesSeriesRef.current = yesSeries;
    noSeriesRef.current = noSeries;

    // Clamp scroll: prevent panning before first data point
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange) return;
      // Logical index 0 = first data point. Prevent scrolling left of it.
      if (logicalRange.from < 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: 0,
          to: logicalRange.to,
        });
      }
    });

    // Responsive resize
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      yesSeriesRef.current = null;
      noSeriesRef.current = null;
    };
  }, []); // eslint-disable-line

  // Update colors when theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
      },
      grid: {
        horzLines: { color: colors.border },
      },
      crosshair: {
        vertLine: { color: colors.dim, labelBackgroundColor: colors.elevated },
        horzLine: { color: colors.dim, labelBackgroundColor: colors.elevated },
      },
    });
    yesSeriesRef.current?.applyOptions({
      lineColor: colors.yes,
      topColor: `${colors.yes}14`,
      bottomColor: `${colors.yes}00`,
      crosshairMarkerBackgroundColor: colors.yes,
      crosshairMarkerBorderColor: colors.bg,
    });
    noSeriesRef.current?.applyOptions({
      lineColor: colors.no,
      topColor: `${colors.no}14`,
      bottomColor: `${colors.no}00`,
      crosshairMarkerBackgroundColor: colors.no,
      crosshairMarkerBorderColor: colors.bg,
    });
  }, [colors]);

  // Update data and visibility based on side prop
  useEffect(() => {
    if (!yesSeriesRef.current || !noSeriesRef.current || !data.length) return;

    const showYes = side === "yes" || side === "both";
    const showNo = side === "no" || side === "both";

    // Always set data on both series first to prevent stale render state
    yesSeriesRef.current.setData(toChartData(data, "yes"));
    noSeriesRef.current.setData(toChartData(data, "no"));

    yesSeriesRef.current.applyOptions({ visible: showYes });
    noSeriesRef.current.applyOptions({ visible: showNo });

    chartRef.current?.timeScale().fitContent();
  }, [data, side, createdAt]);

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <div className="animate-shimmer h-full w-full rounded-lg" />
      </div>
    );
  }

  return <div ref={containerRef} className={cn("w-full h-full", className)} />;
}

export const TradingViewChart = memo(TradingViewChartInner);
