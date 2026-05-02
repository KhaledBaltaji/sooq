"use client";

import { useState, useCallback } from "react";
import { subDays, startOfDay } from "date-fns";
import { StatsDatePicker } from "@/components/admin/stats/stats-date-picker";
import { StatsOverview } from "@/components/admin/stats/stats-overview";
import { ModuleUsers } from "@/components/admin/stats/module-users";
import { ModuleRevenue } from "@/components/admin/stats/module-revenue";
import { ModuleTrading } from "@/components/admin/stats/module-trading";
import { ModuleMarkets } from "@/components/admin/stats/module-markets";
import { ModuleFinance } from "@/components/admin/stats/module-finance";
import { ModuleHealth } from "@/components/admin/stats/module-health";

type Tab = "overview" | "users" | "revenue" | "trading" | "markets" | "finance" | "health";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "dashboard" },
  { key: "users", label: "Users", icon: "group" },
  { key: "revenue", label: "Revenue", icon: "payments" },
  { key: "trading", label: "Trading", icon: "show_chart" },
  { key: "markets", label: "Markets", icon: "analytics" },
  { key: "finance", label: "Finance", icon: "account_balance" },
  { key: "health", label: "Health", icon: "monitor_heart" },
];

export default function AdminStatsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [startDate, setStartDate] = useState(() => startOfDay(subDays(new Date(), 30)).toISOString());
  const [endDate, setEndDate] = useState(() => new Date().toISOString());

  const handleDateChange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Platform Analytics
          </h2>
          <p className="text-[#566166] mt-1 text-sm">
            Comprehensive KPIs across all platform modules.
          </p>
        </div>
        <StatsDatePicker onChange={handleDateChange} />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-[#f0f4f7] rounded-xl p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              tab === t.key
                ? "bg-white text-[#2a3439] shadow-sm"
                : "text-[#566166] hover:text-[#2a3439]"
            }`}
          >
            <span className="material-symbols-outlined text-sm"
              style={tab === t.key ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      {tab === "overview" && <StatsOverview startDate={startDate} endDate={endDate} />}
      {tab === "users" && <ModuleUsers startDate={startDate} endDate={endDate} />}
      {tab === "revenue" && <ModuleRevenue startDate={startDate} endDate={endDate} />}
      {tab === "trading" && <ModuleTrading startDate={startDate} endDate={endDate} />}
      {tab === "markets" && <ModuleMarkets startDate={startDate} endDate={endDate} />}
      {tab === "finance" && <ModuleFinance startDate={startDate} endDate={endDate} />}
      {tab === "health" && <ModuleHealth startDate={startDate} endDate={endDate} />}
    </div>
  );
}
