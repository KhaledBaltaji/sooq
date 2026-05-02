"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { BRANCH_STATUS_CONFIG, BRANCH_BOOK_TYPE_CONFIG } from "@/types/branch";
import type { BranchOverviewRow, BranchStatus, BranchBookType } from "@/types/branch";

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "payback", label: "Payback" },
  { value: "frozen", label: "Frozen" },
  { value: "suspended", label: "Suspended" },
];

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "reseller", label: "Reseller" },
  { value: "commission", label: "Commission" },
  { value: "bookmaker", label: "Bookmaker" },
];

export function BranchesTable({ branches }: { branches: BranchOverviewRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"pool_balance" | "utilization_pct" | "total_volume" | "total_revenue" | "user_count">("pool_balance");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    return branches
      .filter((b) => {
        const matchesSearch = !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.branch_code.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" || b.status === statusFilter;
        const matchesType = typeFilter === "all" || b.book_type === typeFilter;
        return matchesSearch && matchesStatus && matchesType;
      })
      .sort((a, b) => {
        const av = a[sortBy] as number;
        const bv = b[sortBy] as number;
        return sortAsc ? av - bv : bv - av;
      });
  }, [branches, search, statusFilter, typeFilter, sortBy, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const sortIcon = (col: typeof sortBy) => {
    if (sortBy !== col) return "unfold_more";
    return sortAsc ? "expand_less" : "expand_more";
  };

  return (
    <>
      {/* Filter Bar */}
      <div className="bg-[#f0f4f7] rounded-xl p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#717c82]">
            <span className="material-symbols-outlined text-sm">filter_list</span>
          </span>
          <input
            className="w-full bg-white border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/10 focus:outline-none"
            placeholder="Search branches..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider transition-colors ${
                statusFilter === opt.value
                  ? "bg-[#2a3439] text-white"
                  : "bg-white text-[#566166] hover:bg-[#e8eff3]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setTypeFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider transition-colors ${
                typeFilter === opt.value
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-[#566166] hover:bg-[#e8eff3]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Branch</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Status</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166] cursor-pointer select-none" onClick={() => handleSort("pool_balance")}>
                <span className="flex items-center gap-1">Pool <span className="material-symbols-outlined text-xs">{sortIcon("pool_balance")}</span></span>
              </th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166] cursor-pointer select-none" onClick={() => handleSort("utilization_pct")}>
                <span className="flex items-center gap-1">Utilization <span className="material-symbols-outlined text-xs">{sortIcon("utilization_pct")}</span></span>
              </th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166] cursor-pointer select-none" onClick={() => handleSort("user_count")}>
                <span className="flex items-center gap-1">Users <span className="material-symbols-outlined text-xs">{sortIcon("user_count")}</span></span>
              </th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166] cursor-pointer select-none" onClick={() => handleSort("total_volume")}>
                <span className="flex items-center gap-1">Volume <span className="material-symbols-outlined text-xs">{sortIcon("total_volume")}</span></span>
              </th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166] cursor-pointer select-none" onClick={() => handleSort("total_revenue")}>
                <span className="flex items-center gap-1">Revenue <span className="material-symbols-outlined text-xs">{sortIcon("total_revenue")}</span></span>
              </th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Manager</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-16 text-center">
                  <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">store</span>
                  <p className="text-sm font-medium text-[#566166]">No branches found</p>
                </td>
              </tr>
            ) : (
              paginated.map((b, i) => {
                const sc = BRANCH_STATUS_CONFIG[b.status as BranchStatus] || BRANCH_STATUS_CONFIG.active;
                const tc = BRANCH_BOOK_TYPE_CONFIG[b.book_type as BranchBookType] || BRANCH_BOOK_TYPE_CONFIG.reseller;
                const utilizationColor = b.utilization_pct >= 95 ? "text-red-600" : b.utilization_pct >= 80 ? "text-amber-600" : "text-emerald-600";

                return (
                  <tr
                    key={b.id}
                    onClick={() => {
                      setNavigatingId(b.id);
                      startTransition(() => router.push(`/admin/branches/${b.id}`));
                    }}
                    className={`cursor-pointer hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/10" : ""} ${isPending && navigatingId === b.id ? "opacity-60" : ""}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {isPending && navigatingId === b.id && (
                          <span className="w-4 h-4 border-2 border-[var(--yes)] border-t-transparent rounded-full animate-spin shrink-0" />
                        )}
                        <div>
                          <span className="text-sm font-semibold text-[#2a3439]">{b.name}</span>
                          <span className="text-xs text-[#566166] ml-2 font-mono">{b.branch_code}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tc.badgeClass}`}>
                        {tc.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center gap-1.5 text-[11px] font-bold ${sc.textClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dotClass}`} />
                        {sc.label}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-[#2a3439]">{formatCurrency(b.pool_balance)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-bold ${utilizationColor}`}>{b.utilization_pct}%</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{b.user_count}</td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(b.total_volume)}</td>
                    <td className="px-6 py-4 text-sm font-medium text-[#2a3439]">{formatCurrency(b.total_revenue)}</td>
                    <td className="px-6 py-4 text-xs text-[#566166]">{b.manager_name || b.manager_phone || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-xs text-[#566166]">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs bg-white rounded-lg border border-[#d9e4ea] hover:bg-[#f0f4f7] disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs bg-white rounded-lg border border-[#d9e4ea] hover:bg-[#f0f4f7] disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
