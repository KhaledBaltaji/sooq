"use client";

import { useEffect, useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { WithdrawalTable } from "@/components/admin/withdrawal-table";
import { DepositTable } from "@/components/admin/deposit-table";
import { FinanceRequestsTable } from "@/components/admin/finance-requests-table";
import { TransactionLedgerTable } from "@/components/admin/transaction-ledger-table";

const TABS = [
  { key: "requests", label: "Requests", icon: "pending_actions" },
  { key: "deposits", label: "Deposits", icon: "arrow_downward" },
  { key: "withdrawals", label: "Withdrawals", icon: "arrow_upward" },
  { key: "transactions", label: "Transactions", icon: "receipt_long" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface FinanceTabsProps {
  deposits: any[];
  withdrawals: any[];
  transactions: any[];
  adminAdjustments: any[];
  pendingCount: number;
}

/**
 * Tabbed finance view. Seeded from SSR props, stays live via Supabase Realtime
 * on `deposits` + `withdrawals` + `transactions` (INSERT + UPDATE). On any
 * change, debounced refetch repulls the joined rows. Admin credits/debits are
 * surfaced in the Deposits/Withdrawals tabs, so the `transactions` subscription
 * is scoped client-side to admin_credit/admin_debit types (full-ledger filter
 * happens in the refetch query, not the Realtime channel).
 */
export function FinanceTabs({
  deposits: initialDeposits,
  withdrawals: initialWithdrawals,
  transactions,
  adminAdjustments: initialAdminAdjustments,
  pendingCount: initialPendingCount,
}: FinanceTabsProps) {
  const supabase = useSupabase();
  const [activeTab, setActiveTab] = useState<TabKey>("requests");
  const [deposits, setDeposits] = useState(initialDeposits);
  const [withdrawals, setWithdrawals] = useState(initialWithdrawals);
  const [adminAdjustments, setAdminAdjustments] = useState(initialAdminAdjustments);

  useEffect(() => {
    let cancelled = false;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    async function refetchDeposits() {
      const { data } = await supabase
        .from("deposits")
        .select("*, users!inner(display_name, phone)")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (data) setDeposits(data);
    }

    async function refetchWithdrawals() {
      const { data } = await supabase
        .from("withdrawals")
        .select("*, users!inner(display_name, phone)")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (data) setWithdrawals(data);
    }

    async function refetchAdminAdjustments() {
      const { data } = await supabase
        .from("transactions")
        .select("id, user_id, type, amount, description, created_at, users!inner(display_name, phone)")
        .in("type", ["admin_credit", "admin_debit"])
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (data) setAdminAdjustments(data);
    }

    function scheduleRefetch(which: "deposits" | "withdrawals" | "admin") {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => {
        if (which === "deposits") refetchDeposits();
        else if (which === "withdrawals") refetchWithdrawals();
        else refetchAdminAdjustments();
      }, 150);
    }

    const channel = supabase
      .channel("admin-finance-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "deposits" },
        () => scheduleRefetch("deposits"),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deposits" },
        () => scheduleRefetch("deposits"),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "withdrawals" },
        () => scheduleRefetch("withdrawals"),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "withdrawals" },
        () => scheduleRefetch("withdrawals"),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transactions" },
        (payload: any) => {
          const type = payload?.new?.type;
          if (type === "admin_credit" || type === "admin_debit") {
            scheduleRefetch("admin");
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refetchTimer) clearTimeout(refetchTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const adminCredits = useMemo(
    () => adminAdjustments.filter((t: any) => t.type === "admin_credit"),
    [adminAdjustments],
  );
  const adminDebits = useMemo(
    () => adminAdjustments.filter((t: any) => t.type === "admin_debit"),
    [adminAdjustments],
  );

  // Recompute live pending count from the arrays we actually display.
  const pendingCount = useMemo(() => {
    const pendingDeposits = deposits.filter(
      (d: any) => d.status === "pending" || d.status === "pending_review",
    ).length;
    const pendingWithdrawals = withdrawals.filter(
      (w: any) => w.status === "pending",
    ).length;
    return pendingDeposits + pendingWithdrawals;
  }, [deposits, withdrawals]);

  // Fall back to SSR-computed count if live arrays haven't loaded yet (shouldn't
  // happen in practice since state is seeded, but keeps behavior stable).
  const displayedPendingCount = pendingCount || initialPendingCount;

  return (
    <div>
      {/* Tab Bar */}
      <div className="flex items-center gap-2 mb-6">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full whitespace-nowrap transition-colors ${
              activeTab === key
                ? "bg-[var(--yes)] text-white"
                : "bg-[#f0f4f7] text-[#566166] hover:bg-[#e8eff3]"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
            {label}
            {key === "requests" && displayedPendingCount > 0 && (
              <span className="ml-1 bg-white/20 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {displayedPendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "requests" && (
        <FinanceRequestsTable deposits={deposits} withdrawals={withdrawals} />
      )}
      {activeTab === "deposits" && (
        <DepositTable deposits={deposits} adminCredits={adminCredits} />
      )}
      {activeTab === "withdrawals" && (
        <WithdrawalTable withdrawals={withdrawals} adminDebits={adminDebits} />
      )}
      {activeTab === "transactions" && (
        <TransactionLedgerTable transactions={transactions} />
      )}
    </div>
  );
}
