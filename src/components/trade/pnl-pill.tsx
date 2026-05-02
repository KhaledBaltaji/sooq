"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface PnlPillProps {
  pnl: number;
  pnlPct: number;
  label?: string;
  className?: string;
}

export function PnlPill({ pnl, pnlPct, label, className }: PnlPillProps) {
  const isNeutral = Math.abs(pnl) < 0.005;
  const up = !isNeutral && pnl > 0;
  const tone = isNeutral ? "neutral" : up ? "success" : "no";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-satoshi font-bold text-[13px] tabular-nums",
        tone === "success" &&
          "bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] text-success",
        tone === "no" &&
          "bg-[color-mix(in_srgb,var(--color-no)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-no)_30%,transparent)] text-no",
        tone === "neutral" &&
          "bg-[color-mix(in_srgb,var(--color-muted-custom)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-muted-custom)_25%,transparent)] text-muted-custom",
        className
      )}
    >
      {!isNeutral && up && <ArrowUpRight className="w-3 h-3" aria-hidden />}
      {!isNeutral && !up && <ArrowDownRight className="w-3 h-3" aria-hidden />}
      <span>
        {isNeutral ? "" : up ? "+" : ""}
        {formatCurrency(Math.abs(pnl))}
      </span>
      <span className="opacity-70">
        ({isNeutral ? "" : up ? "+" : ""}
        {pnlPct.toFixed(2)}%)
      </span>
      {label && <span className="opacity-60 ml-0.5">{label}</span>}
    </div>
  );
}
