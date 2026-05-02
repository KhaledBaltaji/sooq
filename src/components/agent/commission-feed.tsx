"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentCommissionFeed } from "@/hooks/use-agent-dashboard";
import { CommissionFeedItem } from "./commission-feed-item";

const LAYER_TABS = [
  { label: "All", value: undefined },
  { label: "Direct", value: 1 as const },
  { label: "Indirect", value: 2 as const },
];

export function CommissionFeed({ userId }: { userId: string }) {
  const [layerFilter, setLayerFilter] = useState<1 | 2 | undefined>(undefined);
  const { items, loading, hasMore, loadMore } = useAgentCommissionFeed(layerFilter, userId);

  return (
    <div className="bg-surface rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 space-y-4">
      {/* Header + Filter tabs */}
      <div className="flex items-center justify-between">
        <h3 className="font-satoshi text-xs font-black text-muted-custom uppercase tracking-widest">
          Activity Feed
        </h3>
        <div className="flex gap-1 bg-bg rounded-lg p-0.5">
          {LAYER_TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setLayerFilter(tab.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[10px] font-bold transition-colors",
                layerFilter === tab.value
                  ? "bg-elevated text-text"
                  : "text-muted-custom hover:text-text"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed items */}
      {loading && items.length === 0 ? (
        <div className="space-y-0">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-none border-b border-border-custom/20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Activity className="w-6 h-6 text-dim" />
          </div>
          <p className="text-muted-custom text-sm font-dm-sans">No commission activity yet</p>
          <p className="text-dim text-xs font-dm-sans mt-1">
            Share your referral link to start earning
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-custom/30">
          {items.map((item) => (
            <CommissionFeedItem key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && items.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2.5 text-xs text-muted-custom hover:text-text font-bold font-dm-sans transition-colors border border-border-custom rounded-xl hover:bg-elevated"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
