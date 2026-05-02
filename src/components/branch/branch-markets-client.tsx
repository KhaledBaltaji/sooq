"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { BranchMarketCard } from "./branch-market-card";
import type { MarketWithAmm } from "@/types/market";

// ---- Shared data type (used by page.tsx and card) ----

export interface BranchMarketRevenue {
  markup: number;
  explicitFee: number;
  exitFee: number;
  resolutionFee: number;
  sooqFee: number;
  total: number;
}

export interface BranchMarketData {
  market: MarketWithAmm;
  isEnabled: boolean;
  cashOutEnabled: boolean | null;
  positionCapYes: number | null;
  positionCapNo: number | null;
  revenue: BranchMarketRevenue | null;
  exposure: { yesShares: number; noShares: number };
}

// ---- Constants ----

const STATUS_TABS = ["active", "completed", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const TAB_LABELS: Record<StatusTab, string> = {
  active: "Active",
  completed: "Completed",
  all: "All",
};

// ---- Component ----

export function BranchMarketsClient({
  branchId,
  markets: initialMarkets,
}: {
  branchId: string;
  markets: BranchMarketData[];
}) {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;

  const [markets, setMarkets] = useState(initialMarkets);
  const [activeTab, setActiveTab] = useState<StatusTab>("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // Filter by status tab
  const marketsByTab = useMemo(() => {
    if (activeTab === "active") return markets.filter((d) => d.market.status === "open");
    if (activeTab === "completed")
      return markets.filter((d) => d.market.status === "resolved" || d.market.status === "voided");
    return markets;
  }, [markets, activeTab]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return marketsByTab;
    const q = search.toLowerCase();
    return marketsByTab.filter((d) =>
      (d.market.question_en || "").toLowerCase().includes(q)
    );
  }, [marketsByTab, search]);

  const enabledCount = markets.filter((d) => d.isEnabled).length;

  const handleToggleEnabled = async (marketId: string, newValue: boolean) => {
    setToggling(marketId);
    // Optimistic update
    setMarkets((prev) =>
      prev.map((d) =>
        d.market.id === marketId ? { ...d, isEnabled: newValue } : d
      )
    );

    const { error } = await supabase
      .from("branch_market_config")
      .upsert(
        { branch_id: branchId, market_id: marketId, is_enabled: newValue },
        { onConflict: "branch_id,market_id" }
      );

    if (error) {
      // Revert
      setMarkets((prev) =>
        prev.map((d) =>
          d.market.id === marketId ? { ...d, isEnabled: !newValue } : d
        )
      );
      toast.error("Failed to update", { description: error.message });
    } else {
      toast.success(`Market ${newValue ? "enabled" : "disabled"}`);
      router.refresh();
    }
    setToggling(null);
  };

  return (
    <div className="space-y-6">
      {/* Status tabs + search + counter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors duration-150 ${
                activeTab === tab
                  ? "bg-[var(--yes)] text-white"
                  : "bg-white text-[#566166] hover:text-[#2a3439] hover:bg-[#f0f4f7]"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 sm:flex-none sm:w-56">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#a9b4b9] text-lg">search</span>
            <input
              type="text"
              placeholder="Search markets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#d9e4ea] rounded-xl text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
            />
          </div>
          <p className="text-sm text-[#566166] font-bold whitespace-nowrap">
            {enabledCount} of {markets.length} enabled
          </p>
        </div>
      </div>

      {/* Market grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">storefront</span>
          <p className="text-sm font-medium text-[#566166]">
            {search ? "No markets match your search" : "No markets in this category"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((data) => (
            <BranchMarketCard
              key={data.market.id}
              data={data}
              branchId={branchId}
              isExpanded={expandedId === data.market.id}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === data.market.id ? null : data.market.id))
              }
              onToggleEnabled={handleToggleEnabled}
              toggling={toggling === data.market.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
