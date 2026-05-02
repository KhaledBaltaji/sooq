"use client";

/**
 * Sparkline — simple SVG polyline for price history previews.
 * Ported from the trade-screen design mockup (motion.jsx).
 * Minimal by design: no axes, no labels, optional fill, ending dot.
 */
interface SparklineProps {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
}

export function Sparkline({
  points,
  color = "currentColor",
  width = 80,
  height = 22,
  fill = false,
  className,
}: SparklineProps) {
  if (!points || points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const dx = width / (points.length - 1);

  const pts: [number, number][] = points.map((p, i) => [
    i * dx,
    height - ((p - min) / range) * (height - 4) - 2,
  ]);

  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ");
  const last = pts[pts.length - 1];

  const gradId = `spark-fill-${points.length}-${Math.round(min * 1000)}-${Math.round(max * 1000)}`;
  const fillD = fill ? d + ` L ${width} ${height} L 0 ${height} Z` : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      {fill && fillD && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={fillD} fill={`url(#${gradId})`} />
        </>
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}
