"use client";

import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils";
import { exportToCSV } from "@/lib/csv-export";
import { TransactionDetailModal } from "./transaction-detail-modal";

interface DepositRow {
  id: string;
  amount: number;
  fee: number;
  net_amount: number;
  currency: string;
  provider: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  users: { display_name: string | null; phone: string | null } | null;
}

interface AdminCreditRow {
  id: string;
  user_id: string;
  type: "admin_credit";
  amount: number;
  description: string | null;
  created_at: string;
  users: { display_name: string | null; phone: string | null } | null;
}

const STATUS_STYLES: Record<string, { label: string; dotClass: string; textClass: string }> = {
  pending: { label: "PENDING", dotClass: "bg-[var(--warning)] animate-pulse", textClass: "text-[var(--warning)]" },
  pending_review: { label: "REVIEW", dotClass: "bg-blue-500 animate-pulse", textClass: "text-blue-600" },
  confirmed: { label: "CONFIRMED", dotClass: "bg-emerald-500", textClass: "text-emerald-600" },
  credited: { label: "CREDITED", dotClass: "bg-emerald-500", textClass: "text-emerald-600" },
  failed: { label: "FAILED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
  rejected: { label: "REJECTED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
};

const FILTERS = ["All", "Pending", "Review", "Confirmed", "Credited", "Failed", "Rejected"] as const;

const PROVIDER_LABELS: Record<string, string> = {
  whish_manual: "WHISH",
  "3pay": "3PAY",
  admin_credit: "ADMIN",
};

export function DepositTable({
  deposits,
  adminCredits = [],
}: {
  deposits: DepositRow[];
  adminCredits?: AdminCreditRow[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositRow | null>(null);
  const pageSize = 15;

  const merged = useMemo<DepositRow[]>(() => {
    const adminRows: DepositRow[] = adminCredits.map((t) => ({
      id: `ac-${t.id}`,
      amount: Number(t.amount),
      fee: 0,
      net_amount: Number(t.amount),
      currency: "USD",
      provider: "admin_credit",
      status: "credited",
      created_at: t.created_at,
      confirmed_at: t.created_at,
      users: t.users,
    }));
    return [...deposits, ...adminRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [deposits, adminCredits]);

  const filtered = useMemo(() => {
    return merged.filter((d) => {
      const name = (d.users?.display_name || d.users?.phone || "").toLowerCase();
      const matchesSearch = !search || name.includes(search.toLowerCase());
      const filterStatus = filter === "Review" ? "pending_review" : filter.toLowerCase();
      const matchesFilter = filter === "All" || d.status === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [merged, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const initials = (name: string | null) => {
    if (!name) return "??";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  const handleExportCSV = () => {
    const csvData = filtered.map((d) => ({
      User: d.users?.display_name || d.users?.phone || "Unknown",
      Amount: d.amount,
      Fee: d.fee,
      Net: d.net_amount,
      Currency: d.currency,
      Provider: d.provider,
      Status: d.status,
      Date: new Date(d.created_at).toISOString(),
      Confirmed: d.confirmed_at ? new Date(d.confirmed_at).toISOString() : "",
    }));
    exportToCSV(csvData, `deposits-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <>
      <TransactionDetailModal
        open={!!selectedDeposit}
        onOpenChange={(open) => !open && setSelectedDeposit(null)}
        data={selectedDeposit}
        type="deposit"
      />

      {/* Filter Bar */}
      <div className="bg-[#f0f4f7] rounded-xl p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#717c82]">
            <span className="material-symbols-outlined text-sm">search</span>
          </span>
          <input
            className="w-full bg-white border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/10 focus:outline-none"
            placeholder="Search by user name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#566166] uppercase tracking-wider px-2">Status:</span>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`text-xs font-semibold px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                filter === f
                  ? "bg-[var(--yes)] text-white"
                  : "bg-white text-[#566166] hover:bg-[#e8eff3]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={handleExportCSV}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-white text-[#566166] hover:bg-[#e8eff3] transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-sm">download</span>
          CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7] text-left">
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">User</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Fee</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Net</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Source</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">savings</span>
                    <p className="text-sm font-medium text-[#566166]">No deposits found</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Deposits will appear here</p>
                  </td>
                </tr>
              ) : (
                paginated.map((d, i) => {
                  const displayName = d.users?.display_name || d.users?.phone || "Unknown";
                  const statusConf = STATUS_STYLES[d.status] || STATUS_STYLES.pending;

                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDeposit(d)}
                      className={`hover:bg-[#f0f4f7]/50 transition-colors cursor-pointer ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center text-[10px] font-bold text-[#455367]">
                            {initials(displayName)}
                          </div>
                          <span className="text-sm font-semibold text-[#2a3439]">{displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right text-sm font-medium text-[#2a3439] tabular-nums">
                        {formatCurrency(d.amount)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">
                        {formatCurrency(d.fee)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm font-bold text-[#2a3439] tabular-nums">
                        {formatCurrency(d.net_amount)}
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-xs font-semibold text-[#566166] bg-[#f0f4f7] px-2.5 py-1 rounded-full uppercase">
                          {PROVIDER_LABELS[d.provider] || d.provider}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
                          {statusConf.label}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                        {formatDate(d.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > pageSize && (
          <div className="px-6 py-4 border-t border-[#a9b4b9]/10 flex items-center justify-between">
            <p className="text-xs text-[#566166]">
              Showing <span className="font-bold text-[#2a3439]">{(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filtered.length)}</span> of{" "}
              <span className="font-bold text-[#2a3439]">{filtered.length}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg hover:bg-[#f0f4f7] text-[#717c82] disabled:opacity-30"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold ${
                    page === p ? "bg-[var(--yes)] text-white" : "hover:bg-[#f0f4f7] text-[#566166]"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg hover:bg-[#f0f4f7] text-[#717c82] disabled:opacity-30"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
