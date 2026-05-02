import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface AdminStatCardProps {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  color?: string;
  trend?: { value: number; direction: "up" | "down" };
  className?: string;
}

export function AdminStatCard({
  icon: Icon,
  label,
  value,
  color = "text-text",
  trend,
  className,
}: AdminStatCardProps) {
  return (
    <div
      className={cn(
        "bg-surface rounded-xl p-md border border-border",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-muted text-xs font-dm-sans uppercase tracking-wide">
          {label}
        </p>
        {Icon && (
          <Icon className="w-4 h-4 text-muted" />
        )}
      </div>
      <div className={cn("font-satoshi text-2xl font-bold mt-xs tabular-nums", color)}>
        {value}
      </div>
      {trend && (
        <div
          className={cn(
            "flex items-center gap-xs mt-xs text-xs font-medium",
            trend.direction === "up" ? "text-success" : "text-error"
          )}
        >
          {trend.direction === "up" ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          <span>{trend.value}%</span>
        </div>
      )}
    </div>
  );
}
