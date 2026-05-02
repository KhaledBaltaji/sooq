"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

const STATUSES = ["All", "Active", "Frozen", "Admin"] as const;

const LEVEL_STYLES: Record<number, string> = {
  1: "bg-[#e8eff3] text-[#566166]",
  2: "bg-[var(--yes)]/10 text-[var(--yes)]",
  3: "bg-[var(--warning)]/10 text-[var(--warning)]",
  4: "bg-[var(--success)]/10 text-[var(--success)]",
};

interface UserRow {
  id: string;
  display_name: string | null;
  phone: string | null;
  balance_usd: number;
  agent_level: number;
  direct_referral_count: number;
  is_frozen: boolean;
  is_admin: boolean;
}

type SortKey = "balance_usd" | "direct_referral_count";
type SortDir = "asc" | "desc";

export function UsersTable({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeStatus, setActiveStatus] = useState<(typeof STATUSES)[number]>("All");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const pageSize = 20;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    let result = users.filter((u) => {
      const matchesSearch =
        !search ||
        (u.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.phone || "").toLowerCase().includes(search.toLowerCase()) ||
        u.id.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        activeStatus === "All" ||
        (activeStatus === "Frozen" && u.is_frozen) ||
        (activeStatus === "Admin" && u.is_admin) ||
        (activeStatus === "Active" && !u.is_frozen && !u.is_admin);

      return matchesSearch && matchesStatus;
    });

    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = Number(a[sortKey]);
        const bv = Number(b[sortKey]);
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }

    return result;
  }, [users, search, activeStatus, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const SortHeader = ({ label, column }: { label: string; column: SortKey }) => (
    <th
      className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right cursor-pointer select-none hover:text-[#2a3439] transition-colors"
      onClick={() => toggleSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`material-symbols-outlined text-xs ${sortKey === column ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}>
          swap_vert
        </span>
      </span>
    </th>
  );

  return (
    <>
      {/* Filter Bar */}
      <div className="bg-[#f0f4f7] rounded-xl p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#717c82]">
            <span className="material-symbols-outlined text-sm">search</span>
          </span>
          <input
            className="w-full bg-white border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--yes)]/10 focus:outline-none"
            placeholder="Search by name, phone, or ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-bold text-[#566166] uppercase tracking-wider px-2">Status:</span>
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => {
                setActiveStatus(status);
                setPage(1);
              }}
              className={`text-xs font-semibold px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                activeStatus === status
                  ? "bg-[var(--yes)] text-white"
                  : "bg-white text-[#566166] border border-transparent hover:border-[#a9b4b9]"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7] text-left">
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Name</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Phone</th>
                <SortHeader label="Balance" column="balance_usd" />
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Level</th>
                <SortHeader label="Referrals" column="direct_referral_count" />
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">group</span>
                    <p className="text-sm font-medium text-[#566166]">No users found</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Try adjusting your search or status filter</p>
                  </td>
                </tr>
              ) : (
                paginated.map((u, i) => {
                  const levelStyle = LEVEL_STYLES[u.agent_level] || LEVEL_STYLES[1];

                  return (
                    <tr
                      key={u.id}
                      onClick={() => {
                        setNavigatingId(u.id);
                        startTransition(() => router.push(`/admin/users/${u.id}`));
                      }}
                      className={`hover:bg-[#f0f4f7]/50 active:bg-[#e8eff3] cursor-pointer transition-colors group ${
                        i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
                      } ${isPending && navigatingId === u.id ? "opacity-60" : ""}`}
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          {isPending && navigatingId === u.id && (
                            <span className="w-4 h-4 border-2 border-[var(--yes)] border-t-transparent rounded-full animate-spin shrink-0" />
                          )}
                          <Link href={`/admin/users/${u.id}`}>
                            <p className="text-sm font-semibold text-[#2a3439] leading-snug group-hover:text-[var(--yes)] transition-colors">
                              {u.display_name || "Anonymous"}
                            </p>
                          </Link>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166]">
                        {u.phone || "—"}
                      </td>
                      <td className="px-6 py-5 text-right text-sm font-medium tabular-nums">
                        {formatCurrency(u.balance_usd)}
                      </td>
                      <td className="px-6 py-5">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${levelStyle}`}>
                          L{u.agent_level}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">
                        {u.direct_referral_count}
                      </td>
                      <td className="px-6 py-5">
                        {u.is_frozen ? (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--error)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)]" />
                            FROZEN
                          </div>
                        ) : u.is_admin ? (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--yes)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--yes)]" />
                            ADMIN
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            ACTIVE
                          </div>
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
          <div className="px-6 py-4 border-t border-[#a9b4b9]/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-[#566166]">
              Showing{" "}
              <span className="font-bold text-[#2a3439]">
                {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filtered.length)}
              </span>{" "}
              of <span className="font-bold text-[#2a3439]">{filtered.length}</span> users
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
                    page === p
                      ? "bg-[var(--yes)] text-white"
                      : "hover:bg-[#f0f4f7] text-[#566166]"
                  }`}
                >
                  {p}
                </button>
              ))}
              {totalPages > 5 && (
                <>
                  <span className="px-2 text-[#a9b4b9]">...</span>
                  <button
                    onClick={() => setPage(totalPages)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold ${
                      page === totalPages ? "bg-[var(--yes)] text-white" : "hover:bg-[#f0f4f7] text-[#566166]"
                    }`}
                  >
                    {totalPages}
                  </button>
                </>
              )}
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
