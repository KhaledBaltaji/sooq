"use client";

// Phase 5K — /admin/stats wrapper. Tab nav (Revenue / Money / Users /
// Health) + global filters (time range + asset). Each tab fetches its
// own data. Active tab is reflected in the search param so refresh +
// link-sharing preserves the view.

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  Wallet,
  Users,
  Activity,
} from "lucide-react";
import { StatsRevenueTab } from "./stats-revenue-tab";
import { StatsMoneyTab } from "./stats-money-tab";
import { StatsUsersTab } from "./stats-users-tab";
import { StatsHealthTab } from "./stats-health-tab";

type TabKey = "revenue" | "money" | "users" | "health";
type Range = "today" | "7d" | "30d" | "all";
type AssetFilter = "all" | "BTC" | "GOLD";

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7d" },
  { key: "30d", label: "Last 30d" },
  { key: "all", label: "All time" },
];

const ASSET_FILTERS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "All assets" },
  { key: "BTC", label: "BTC" },
  { key: "GOLD", label: "GOLD" },
];

const TABS: {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  hint: string;
}[] = [
  {
    key: "revenue",
    label: "Revenue",
    icon: <TrendingUp className="w-4 h-4" />,
    hint: "Stakes in, payouts out, per-market P&L",
  },
  {
    key: "money",
    label: "Money",
    icon: <Wallet className="w-4 h-4" />,
    hint: "Deposits, withdrawals, balance held",
  },
  {
    key: "users",
    label: "Users",
    icon: <Users className="w-4 h-4" />,
    hint: "DAU, WAU, leaderboard",
  },
  {
    key: "health",
    label: "Health",
    icon: <Activity className="w-4 h-4" />,
    hint: "Oracle, matrix, CLV, alerts",
  },
];

function rangeToISO(range: Range): { from: string | null; to: string | null } {
  if (range === "all") return { from: null, to: null };
  const now = new Date();
  const from = new Date(now);
  if (range === "today") from.setHours(0, 0, 0, 0);
  if (range === "7d") from.setDate(now.getDate() - 7);
  if (range === "30d") from.setDate(now.getDate() - 30);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function StatsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabFromUrl = (searchParams.get("tab") ?? "revenue") as TabKey;
  const validTab: TabKey = TABS.some((t) => t.key === tabFromUrl)
    ? tabFromUrl
    : "revenue";

  const [tab, setTab] = useState<TabKey>(validTab);
  const [range, setRange] = useState<Range>("7d");
  const [asset, setAsset] = useState<AssetFilter>("all");

  // Sync tab back to search param so refresh / link-sharing preserves the view.
  useEffect(() => {
    if (tabFromUrl !== tab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const isoRange = useMemo(() => rangeToISO(range), [range]);

  return (
    <div className="space-y-5">
      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-[#e9ecef] flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            title={t.hint}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
              tab === t.key
                ? "border-[#2d6cdf] text-[#2a3439]"
                : "border-transparent text-[#566166] hover:text-[#2a3439]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Global filters — range + asset */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-colors",
                range === r.key
                  ? "bg-[#2d6cdf] text-white"
                  : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Asset filter — Health tab ignores it (intrinsically per-asset);
            Money tab ignores it (deposits/withdrawals aren't asset-keyed) */}
        {(tab === "revenue" || tab === "users") && (
          <div className="inline-flex flex-wrap gap-1.5 ml-1">
            {ASSET_FILTERS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAsset(a.key)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-md transition-colors",
                  asset === a.key
                    ? "bg-[#2a3439] text-white"
                    : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active tab body */}
      {tab === "revenue" && (
        <StatsRevenueTab isoRange={isoRange} asset={asset} />
      )}
      {tab === "money" && <StatsMoneyTab isoRange={isoRange} />}
      {tab === "users" && <StatsUsersTab isoRange={isoRange} />}
      {tab === "health" && <StatsHealthTab />}
    </div>
  );
}
