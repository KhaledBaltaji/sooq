"use client";

import { cn } from "@/lib/utils";

export type PositionFilter = "all" | "gainers" | "losers" | "closing";

interface ChipSpec {
  id: PositionFilter;
  label: string;
  count: number | null;
}

interface PositionSortChipsProps {
  chips: ChipSpec[];
  active: PositionFilter;
  onChange: (next: PositionFilter) => void;
  className?: string;
}

export function PositionSortChips({
  chips,
  active,
  onChange,
  className,
}: PositionSortChipsProps) {
  return (
    <div
      className={cn("flex gap-1.5 overflow-x-auto", className)}
      style={{ scrollbarWidth: "none" }}
    >
      {chips.map((c) => {
        const on = active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-dm-sans font-semibold text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer",
              on
                ? "bg-text text-bg border border-text"
                : "bg-surface text-text border border-border-custom hover:bg-elevated"
            )}
            aria-pressed={on}
          >
            {c.label}
            {c.count !== null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px font-satoshi font-bold text-[11px] tabular-nums",
                  on ? "bg-black/15 text-bg" : "bg-elevated text-muted-custom"
                )}
              >
                {c.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
