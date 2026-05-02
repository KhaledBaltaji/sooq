"use client";

import { useActivityFeed } from "@/hooks/use-activity-feed";
import { formatCurrency, cn } from "@/lib/utils";

interface ActivityFeedProps {
  marketId?: string;
}

export function ActivityFeed({ marketId }: ActivityFeedProps) {
  const { items } = useActivityFeed(marketId);

  if (items.length === 0) {
    return (
      <div className="text-center py-lg">
        <p className="text-muted text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-xs">
      {items.map((item, i) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center justify-between px-sm py-xs",
            "text-sm font-dm-sans",
            "animate-in slide-in-from-right duration-200"
          )}
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <div className="flex items-center gap-xs">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                item.side === "yes" ? "bg-yes" : "bg-no"
              )}
            />
            <span className="text-muted">Someone traded</span>
            <span className={item.side === "yes" ? "text-yes" : "text-no"}>
              {item.side.toUpperCase()}
            </span>
          </div>
          <span className="text-text font-medium tabular-nums">
            {formatCurrency(item.total_cost)}
          </span>
        </div>
      ))}
    </div>
  );
}
