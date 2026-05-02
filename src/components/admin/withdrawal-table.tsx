"use client";

import { useState, useMemo } from "react";
import { WithdrawalActions } from "@/components/admin/withdrawal-actions";
import { formatCurrency } from "@/lib/utils";
import { exportToCSV } from "@/lib/csv-export";
import { TransactionDetailModal } from "./transaction-detail-modal";

interface WithdrawalRow {
  id: string;
  amount: number;
  fee: number;
  net_amount: number;
  status: string;
  created_at: string;
  users: { display_name: string | null; phone: string | null } | null;
  source?: string;
  // Fields added in migration 284 (withdrawal lifecycle)
  destination?: string | null;
  destination_type?: string | null;   // 'crypto' | 'whish' | 'bank'
  network?: string | null;             // 'TRC20' | 'ERC20' | null
  provider?: string | null;            // '3pay' | 'whish_manual' | 'bank_manual'
  external_reference_id?: string | null;
  sent_at?: string | null;
}

interface AdminDebitRow {
  id: string;
  user_id: string;
  type: "admin_debit";
  amount: number;
  description: string | null;
  created_at: string;
  users: { display_name: string | null; phone: string | null } | null;
}

const STATUS_STYLES: Record<string, { label: string; dotClass: string; textClass: string }> = {
  pending: { label: "PENDING", dotClass: "bg-[var(--warning)] animate-pulse", textClass: "text-[var(--warning)]" },
  approved: { label: "APPROVED", dotClass: "bg-emerald-500 animate-pulse", textClass: "text-emerald-600" },
  sent: { label: "SENT", dotClass: "bg-blue-500", textClass: "text-blue-600" },
  completed: { label: "COMPLETED", dotClass: "bg-emerald-600", textClass: "text-emerald-700" },
  failed: { label: "FAILED", dotClass: "bg-red-600", textClass: "text-red-700" },
  debited: { label: "DEBITED", dotClass: "bg-red-500", textClass: "text-red-600" },
  rejected: { label: "REJECTED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
};

const FILTERS = ["All", "Pending", "Approved", "Sent", "Completed", "Failed", "Debited", "Rejected"] as const;
// Launch scope: Whish (Lebanese mobile) + Crypto (USDT TRC20) + Admin adjustments.
// Bank filter removed — bank withdrawals not supported at launch (see migration 288).
const PROVIDER_FILTERS = ["All", "Whish", "Crypto", "Admin"] as const;

// Dynamic provider label — replaces the hardcoded "WHISH" fallback.
function providerSourceLabel(row: WithdrawalRow): string {
  if (row.source === "admin_debit") return "ADMIN";
  const p = row.provider;
  const dt = row.destination_type;
  if (p === "3pay" || dt === "crypto") {
    return row.network ? `USDT ${row.network}` : "USDT TRC20";
  }
  if (p === "whish_manual" || dt === "whish") return "WHISH";
  return "WHISH"; // legacy fallback for rows predating migration 284
}

function providerGroup(row: WithdrawalRow): "Whish" | "Crypto" | "Admin" | "Unknown" {
  if (row.source === "admin_debit") return "Admin";
  const p = row.provider;
  const dt = row.destination_type;
  if (p === "3pay" || dt === "crypto") return "Crypto";
  if (p === "whish_manual" || dt === "whish") return "Whish";
  return "Unknown";
}

function truncateDestination(dest: string | null | undefined): string {
  if (!dest) return "—";
  if (dest.length <= 14) return dest;
  return `${dest.slice(0, 6)}…${dest.slice(-6)}`;
}

export function WithdrawalTable({
  withdrawals,
  adminDebits = [],
}: {
  withdrawals: WithdrawalRow[];
  adminDebits?: AdminDebitRow[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const [providerFilter, setProviderFilter] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRow | null>(null);
  const pageSize = 15;

  const merged = useMemo<WithdrawalRow[]>(() => {
    const baseRows: WithdrawalRow[] = withdrawals.map((w) => ({ ...w, source: "withdrawal" }));
    const adminRows: WithdrawalRow[] = adminDebits.map((t) => ({
      id: `ad-${t.id}`,
      amount: Math.abs(Number(t.amount)),
      fee: 0,
      net_amount: Math.abs(Number(t.amount)),
      status: "debited",
      created_at: t.created_at,
      users: t.users,
      source: "admin_debit",
    }));
    return [...baseRows, ...adminRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [withdrawals, adminDebits]);

  const filtered = useMemo(() => {
    return merged.filter((w) => {
      const name = (w.users?.display_name || w.users?.phone || "").toLowerCase();
      const dest = (w.destination || "").toLowerCase();
      const query = search.toLowerCase();
      const matchesSearch = !search || name.includes(query) || dest.includes(query);
      const matchesFilter = filter === "All" || w.status === filter.toLowerCase();
      const matchesProvider = providerFilter === "All" || providerGroup(w) === providerFilter;
      return matchesSearch && matchesFilter && matchesProvider;
    });
  }, [merged, search, filter, providerFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const initials = (name: string | null) => {
    if (!name) return "??";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  const handleExportCSV = () => {
    const csvData = filtered.map((w) => ({
      User: w.users?.display_name || w.users?.phone || "Unknown",
      Amount: w.amount,
      Fee: w.fee,
      Net: w.net_amount,
      Provider: providerSourceLabel(w),
      Destination: w.destination || "",
      Network: w.network || "",
      Status: w.status,
      ExternalReferenceId: w.external_reference_id || "",
      SentAt: w.sent_at || "",
      Date: new Date(w.created_at).toISOString(),
    }));
    exportToCSV(csvData, `withdrawals-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <>
      <TransactionDetailModal
        open={!!selectedWithdrawal}
        onOpenChange={(open) => !open && setSelectedWithdrawal(null)}
        data={selectedWithdrawal}
        type="withdrawal"
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
        <div className="flex items-center gap-2 flex-wrap">
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-[#566166] uppercase tracking-wider px-2">Rail:</span>
          {PROVIDER_FILTERS.map((p) => (
            <button
              key={p}
              onClick={() => { setProviderFilter(p); setPage(1); }}
              className={`text-xs font-semibold px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                providerFilter === p
                  ? "bg-[var(--yes)] text-white"
                  : "bg-white text-[#566166] hover:bg-[#e8eff3]"
              }`}
            >
              {p}
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
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Net</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Rail</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Destination</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center"> {/* 8 cols: User, Amount, Net, Rail, Destination, Status, Date, Actions */}
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">account_balance_wallet</span>
                    <p className="text-sm font-medium text-[#566166]">No withdrawals found</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Withdrawal requests will appear here</p>
                  </td>
                </tr>
              ) : (
                paginated.map((w, i) => {
                  const displayName = w.users?.display_name || w.users?.phone || "Unknown";
                  const statusConf = STATUS_STYLES[w.status] || STATUS_STYLES.pending;

                  return (
                    <tr
                      key={w.id}
                      onClick={() => setSelectedWithdrawal(w)}
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
                        {formatCurrency(w.amount)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm font-bold text-[#2a3439] tabular-nums">
                        {formatCurrency(w.net_amount)}
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-xs font-semibold text-[#566166] bg-[#f0f4f7] px-2.5 py-1 rounded-full uppercase whitespace-nowrap">
                          {providerSourceLabel(w)}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        {w.source === "admin_debit" ? (
                          <span className="text-xs text-[#a9b4b9] italic">—</span>
                        ) : w.destination ? (
                          <span
                            className="text-xs font-mono text-[#455367] bg-white border border-[#a9b4b9]/30 px-2 py-1 rounded inline-block"
                            title={w.destination}
                          >
                            {truncateDestination(w.destination)}
                          </span>
                        ) : (
                          <span className="text-xs text-red-500 italic">⚠ none</span>
                        )}
                      </td>
                      <td className="px-6 py-5">
                        <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
                          {statusConf.label}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                        {formatDate(w.created_at)}
                      </td>
                      <td
                        className="px-6 py-5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.source === "admin_debit" ? (
                          <span className="text-xs text-[#a9b4b9]">Instant</span>
                        ) : (
                          <WithdrawalActions
                            withdrawal={{
                              id: w.id,
                              amount: w.amount,
                              user_name: displayName,
                              net_amount: w.net_amount,
                              status: w.status,
                              destination: w.destination,
                              destination_type: w.destination_type,
                              network: w.network,
                              provider: w.provider,
                              external_reference_id: w.external_reference_id,
                            }}
                          />
                        )}
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
