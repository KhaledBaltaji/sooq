"use client";

import { useState, useCallback } from "react";
import { subDays, startOfDay } from "date-fns";
import { StatsDatePicker } from "@/components/admin/stats/stats-date-picker";
import { ModulePlatformPnL } from "@/components/admin/accounting/module-platform-pnl";
import { ModuleAmmAccounting } from "@/components/admin/accounting/module-amm-accounting";
import { ModuleBranchAccounting } from "@/components/admin/accounting/module-branch-accounting";
import { ModuleCommissionAccounting } from "@/components/admin/accounting/module-commission-accounting";

type Tab = "pnl" | "amm" | "branches" | "commissions";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "pnl", label: "Platform P&L", icon: "account_balance_wallet" },
  { key: "amm", label: "AMM", icon: "monitoring" },
  { key: "branches", label: "Branches", icon: "store" },
  { key: "commissions", label: "Commissions", icon: "group" },
];

export default function AdminAccountingPage() {
  const [tab, setTab] = useState<Tab>("pnl");
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
            Accounting
          </h2>
          <p className="text-[#566166] mt-1 text-sm">
            Revenue, costs, and profitability across the platform.
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
      {tab === "pnl" && <ModulePlatformPnL startDate={startDate} endDate={endDate} />}
      {tab === "amm" && <ModuleAmmAccounting startDate={startDate} endDate={endDate} />}
      {tab === "branches" && <ModuleBranchAccounting startDate={startDate} endDate={endDate} />}
      {tab === "commissions" && <ModuleCommissionAccounting startDate={startDate} endDate={endDate} />}
    </div>
  );
}
