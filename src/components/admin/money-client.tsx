"use client";

// Top-level shell for /admin/money. Owns the tab switcher and sync to
// the `?tab=` query param so deep links from the redirect at
// /admin/withdrawals → /admin/money?tab=withdrawals land on the right
// tab. Each tab is its own subcomponent so the file stays readable.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { MoneyDepositsTab } from "./money-deposits-tab";
import { MoneyWithdrawalsTab } from "./money-withdrawals-tab";
import { MoneyAdjustTab } from "./money-adjust-tab";
import { MoneyHistoryTab } from "./money-history-tab";

type MoneyTab = "deposits" | "withdrawals" | "adjust" | "history";

const TABS: { key: MoneyTab; label: string }[] = [
  { key: "deposits", label: "Deposits" },
  { key: "withdrawals", label: "Withdrawal requests" },
  { key: "adjust", label: "Manual adjust" },
  { key: "history", label: "History" },
];

function isMoneyTab(s: string | null): s is MoneyTab {
  return s === "deposits" || s === "withdrawals" || s === "adjust" || s === "history";
}

export function MoneyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<MoneyTab>(isMoneyTab(initial) ? initial : "deposits");

  // Reflect current tab into the URL without pushing history entries
  // for every click — keeps back-button intuitive.
  useEffect(() => {
    const next = new URLSearchParams(Array.from(params.entries()));
    next.set("tab", tab);
    router.replace(`?${next.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              tab === t.key
                ? "bg-[#2d6cdf] text-white"
                : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "deposits" && <MoneyDepositsTab />}
      {tab === "withdrawals" && <MoneyWithdrawalsTab />}
      {tab === "adjust" && <MoneyAdjustTab />}
      {tab === "history" && <MoneyHistoryTab />}
    </div>
  );
}
