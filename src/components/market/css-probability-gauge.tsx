"use client";

import { useTranslations } from "next-intl";

interface CSSProbabilityGaugeProps {
  percent: number;
  /** Outer diameter in px */
  size?: number;
}

/**
 * Semi-circle probability gauge with rounded endpoints.
 * Uses SVG stroke-dasharray for the arc + stroke-linecap: round.
 */
export function CSSProbabilityGauge({ percent, size = 80 }: CSSProbabilityGaugeProps) {
  const t = useTranslations("market");
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  // Semi-circle arc length = π * r
  const halfCircumference = Math.PI * radius;
  // How much of the arc to fill (0–100% maps to 0–halfCircumference)
  const fillLength = (percent / 100) * halfCircumference;
  const gapLength = halfCircumference - fillLength;

  return (
    <div className="flex flex-col items-center flex-shrink-0" style={{ width: size }}>
      <svg
        width={size}
        height={size / 2 + strokeWidth / 2}
        viewBox={`0 0 ${size} ${size / 2 + strokeWidth / 2}`}
        className="overflow-visible"
      >
        {/* Background track (gray arc) */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Filled arc (blue) */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="var(--yes)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${fillLength} ${gapLength}`}
        />
      </svg>
      <span className="text-text font-black text-base font-satoshi -mt-4 tabular-nums">
        {percent.toFixed(1)}%
      </span>
      <span className="text-yes text-[10px] font-bold leading-none">
        {t("yesLabelLower")}
      </span>
    </div>
  );
}
