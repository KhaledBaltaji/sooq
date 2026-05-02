"use client";

import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils";
import { exportToCSV } from "@/lib/csv-export";
import { TransactionDetailModal } from "./transaction-detail-modal";

interface TransactionRow {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  description: string | null;
  created_at: string;
  users: { display_name: string | null; phone: string | null } | null;
}

const TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  deposit: { label: "Deposit", color: "text-emerald-700", bg: "bg-emerald-50" },
  withdrawal: { label: "Withdrawal", color: "text-amber-700", bg: "bg-amber-50" },
  trade: { label: "Trade", color: "text-blue-700", bg: "bg-blue-50" },
  close_position: { label: "Cash Out", color: "text-violet-700", bg: "bg-violet-50" },
  commission: { label: "Commission", color: "text-indigo-700", bg: "bg-indigo-50" },
  bonus: { label: "Bonus", color: "text-pink-700", bg: "bg-pink-50" },
  refund: { label: "Refund", color: "text-teal-700", bg: "bg-teal-50" },
  resolution_payout: { label: "Payout", color: "text-emerald-700", bg: "bg-emerald-50" },
  resolution_fee: { label: "Res. Fee", color: "text-orange-700", bg: "bg-orange-50" },
  bet: { label: "Trade", color: "text-sky-700", bg: "bg-sky-50" },
  win: { label: "Win", color: "text-green-700", bg: "bg-green-50" },
  seed: { label: "Seed", color: "text-gray-700", bg: "bg-gray-100" },
  agent_transfer_out: { label: "Agent Out", color: "text-amber-700", bg: "bg-amber-50" },
  agent_transfer_in: { label: "Agent In", color: "text-emerald-700", bg: "bg-emerald-50" },
  admin_credit: { label: "Admin Credit", color: "text-emerald-700", bg: "bg-emerald-50" },
  admin_debit: { label: "Admin Debit", color: "text-red-700", bg: "bg-red-50" },
};

const TYPE_OPTIONS = [
  "All",
  "deposit",
  "withdrawal",
  "trade",
  "close_position",
  "commission",
  "bonus",
  "refund",
  "resolution_payout",
  "resolution_fee",
  "bet",
  "win",
  "seed",
  "admin_credit",
  "admin_debit",
] as const;

export function TransactionLedgerTable({ transactions }: { transactions: TransactionRow[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionRow | null>(null);
  const pageSize = 15;

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const name = (t.users?.display_name || t.users?.phone || "").toLowerCase();
      const desc = (t.description || "").toLowerCase();
      const matchesSearch = !search || name.includes(search.toLowerCase()) || desc.includes(search.toLowerCase());
      const matchesType = typeFilter === "All" || t.type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [transactions, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const initials = (name: string | null) => {
    if (!name) return "??";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  const truncateId = (id: string | null) => {
    if (!id) return "—";
    return `${id.slice(0, 8)}...`;
  };

  const handleExportCSV = () => {
    const csvData = filtered.map((t) => ({
      User: t.users?.display_name || t.users?.phone || "Unknown",
      Type: t.type,
      Amount: t.amount,
      "Balance After": t.balance_after,
      Description: t.description || "",
      "Reference ID": t.reference_id || "",
      Date: new Date(t.created_at).toISOString(),
    }));
    exportToCSV(csvData, `transactions-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <>
      <TransactionDetailModal
        open={!!selectedTransaction}
        onOpenChange={(open) => !open && setSelectedTransaction(null)}
        data={selectedTransaction}
        type="transaction"
      />

      {/* Filter Bar */}
      <div className="bg-[#f0f4f7] rounded-xl p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#717c82]">
            <span className="material-symbols-outlined text-sm">search</span>
          </span>
          <input
            className="w-full bg-white border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/10 focus:outline-none"
            placeholder="Search by user name or description..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#566166] uppercase tracking-wider px-2">Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="bg-white text-sm text-[#2a3439] font-semibold px-4 py-2.5 rounded-lg border-none focus:ring-2 focus:ring-[var(--yes)]/10 focus:outline-none cursor-pointer"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "All" ? "All Types" : (TYPE_STYLES[t]?.label || t)}
              </option>
            ))}
          </select>
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
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Balance After</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Description</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Reference</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">receipt_long</span>
                    <p className="text-sm font-medium text-[#566166]">No transactions found</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Transaction records will appear here</p>
                  </td>
                </tr>
              ) : (
                paginated.map((t, i) => {
                  const displayName = t.users?.display_name || t.users?.phone || "Unknown";
                  const typeConf = TYPE_STYLES[t.type] || { label: t.type, color: "text-gray-700", bg: "bg-gray-100" };
                  const isPositive = t.amount >= 0;

                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTransaction(t)}
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
                      <td className="px-6 py-5">
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${typeConf.bg} ${typeConf.color}`}>
                          {typeConf.label}
                        </span>
                      </td>
                      <td className={`px-6 py-5 text-right text-sm font-bold tabular-nums ${
                        isPositive ? "text-emerald-600" : "text-[var(--error)]"
                      }`}>
                        {isPositive ? "+" : ""}{formatCurrency(Math.abs(t.amount))}
                      </td>
                      <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">
                        {formatCurrency(t.balance_after)}
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166] max-w-[200px] truncate">
                        {t.description || "—"}
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-xs text-[#a9b4b9] font-mono" title={t.reference_id || undefined}>
                          {truncateId(t.reference_id)}
                        </span>
                      </td>
                      <td className="px-6 py-5 whitespace-nowrap">
                        <div className="text-sm text-[#566166]">{formatDate(t.created_at)}</div>
                        <div className="text-[11px] text-[#a9b4b9]">{formatTime(t.created_at)}</div>
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
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                return startPage + i;
              }).filter(p => p <= totalPages).map((p) => (
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
