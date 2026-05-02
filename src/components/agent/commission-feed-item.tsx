"use client";

import { Lock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { AgentCommissionFeedItem } from "@/types/agent";

interface CommissionFeedItemProps {
  item: AgentCommissionFeedItem;
}

const LAYER_STYLES = {
  1: { bg: "bg-yes/10", text: "text-yes", border: "border-yes/30", label: "Direct" },
  2: { bg: "bg-warning/10", text: "text-warning", border: "border-warning/30", label: "Indirect" },
} as const;

export function CommissionFeedItem({ item }: CommissionFeedItemProps) {
  const time = new Date(item.created_at);
  const timeStr = time.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }) + " " + time.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const style = LAYER_STYLES[item.layer];

  // Show the lock badge only when unlock_at is set AND in the future.
  // Past unlock_at → already available, no badge. Missing unlock_at
  // → grandfathered/instant commission, no badge.
  const unlockDate = item.unlock_at ? new Date(item.unlock_at) : null;
  const isLocked = unlockDate ? unlockDate.getTime() > Date.now() : false;
  const unlockLabel = isLocked && unlockDate
    ? unlockDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="px-1 py-3.5 flex items-center gap-3 hover:bg-elevated/50 transition-colors rounded-lg -mx-1">
      {/* Layer badge */}
      <div className="shrink-0">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${style.bg} ${style.text} ${style.border}`}>
          {style.label}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text font-dm-sans truncate">
          {item.trader_name}
          {item.trade_side && (
            <span className={`ms-1.5 text-xs font-bold ${item.trade_side === "yes" ? "text-yes" : "text-no"}`}>
              ({item.trade_side.toUpperCase()})
            </span>
          )}
        </p>
        <p className="text-xs text-muted-custom font-dm-sans truncate">
          {item.market_question || (item.revenue_type === "resolution" ? "Resolution fee" : "Trade")}
        </p>
      </div>

      {/* Amount + time + lock badge */}
      <div className="text-right shrink-0">
        <p
          className="text-sm text-success font-satoshi font-bold tabular-nums"
          style={{ textShadow: "0 0 8px rgba(0, 232, 123, 0.2)" }}
        >
          +{formatCurrency(item.commission_amount)}
        </p>
        <p className="text-[10px] text-muted-custom tabular-nums font-dm-sans flex items-center gap-1 justify-end">
          {isLocked && (
            <span
              title={`Locked until ${unlockDate!.toLocaleString()}`}
              className="inline-flex items-center gap-0.5 text-warning font-bold"
            >
              <Lock className="w-2.5 h-2.5" />
              {unlockLabel}
            </span>
          )}
          {isLocked && <span className="text-dim">·</span>}
          <span>{timeStr}</span>
        </p>
      </div>
    </div>
  );
}
