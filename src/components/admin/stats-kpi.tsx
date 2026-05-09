"use client";

import { cn } from "@/lib/utils";

// Phase 5K — shared KPI card across all four tabs.

export function Kpi({
  label,
  value,
  icon,
  tone = "muted",
  hint,
  large = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "good" | "bad" | "muted" | "warn";
  hint?: string;
  large?: boolean;
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
                : tone === "warn"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-[#dae2fd] text-[#4a5167]",
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
          "font-extrabold tabular-nums",
          large ? "text-3xl" : "text-2xl",
          tone === "good"
            ? "text-emerald-700"
            : tone === "bad"
              ? "text-red-700"
              : tone === "warn"
                ? "text-amber-800"
                : "text-[#2a3439]",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-[#717c82] mt-1">{hint}</div>}
    </div>
  );
}
