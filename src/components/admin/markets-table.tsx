"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";
import type { MarketStatus } from "@/types/database";

const CATEGORY_KEYS = ["all", "politics", "economy", "sports", "tech", "entertainment", "other"] as const;

const CATEGORY_STYLES: Record<string, string> = {
  politics: "bg-[#dae2fd] text-[#4a5167]",
  economy: "bg-[#d5e3fc] text-[#455367]",
  sports: "bg-[#d9e4ea] text-[#566166]",
  tech: "bg-[#e3dbfd] text-[#514d68]",
  entertainment: "bg-[#e3dbfd] text-[#514d68]",
  other: "bg-[#e8eff3] text-[#566166]",
};

const STATUS_CONFIG: Record<MarketStatus, { label: string; dotClass: string; textClass: string }> = {
  draft: { label: "DRAFT", dotClass: "bg-[#717c82]", textClass: "text-[#566166]" },
  open: { label: "OPEN", dotClass: "bg-emerald-500 animate-pulse", textClass: "text-emerald-600" },
  closed: { label: "CLOSED", dotClass: "bg-[#717c82]", textClass: "text-[#566166]/60" },
  resolved: { label: "RESOLVED", dotClass: "bg-[var(--yes)]", textClass: "text-[var(--yes)]" },
  voided: { label: "VOIDED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
};

interface MarketRow {
  id: string;
  question_en: string;
  status: MarketStatus;
  category: string;
  created_at: string;
  amm: {
    total_volume: number;
    current_yes_price: number;
    current_no_price: number;
    total_trades: number;
  } | null;
}

export function MarketsTable({ markets }: { markets: MarketRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const t = useTranslations("admin");
  const tm = useTranslations("markets");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    return markets.filter((m) => {
      const matchesSearch = !search || (m.question_en || "").toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === "all" || m.category?.toLowerCase() === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [markets, search, activeCategory]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const shortId = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

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
            placeholder={t("searchMarkets")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-bold text-[#566166] uppercase tracking-wider px-2">Categories:</span>
          {CATEGORY_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => { setActiveCategory(key); setPage(1); }}
              className={`text-xs font-semibold px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                activeCategory === key
                  ? "bg-[var(--yes)] text-white"
                  : "bg-white text-[#566166] border border-transparent hover:border-[#a9b4b9]"
              }`}
            >
              {tm(key)}
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
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">ID</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest min-w-[300px]">Question</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Category</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-center">AMM Prices</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Volume</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Trades</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">analytics</span>
                    <p className="text-sm font-medium text-[#566166]">No markets found</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Try adjusting your search or category filter</p>
                  </td>
                </tr>
              ) : (
                paginated.map((m, i) => {
                  const statusConf = STATUS_CONFIG[m.status] || STATUS_CONFIG.draft;
                  const catStyle = CATEGORY_STYLES[m.category?.toLowerCase()] || CATEGORY_STYLES.other;

                  return (
                    <tr
                      key={m.id}
                      onClick={() => {
                        setNavigatingId(m.id);
                        startTransition(() => router.push(`/admin/markets/${m.id}`));
                      }}
                      className={`hover:bg-[#f0f4f7]/50 active:bg-[#e8eff3] cursor-pointer transition-colors group ${
                        i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
                      } ${isPending && navigatingId === m.id ? "opacity-60" : ""}`}
                    >
                      <td className="px-6 py-5 text-sm font-mono text-[#566166]">
                        <div className="flex items-center gap-2">
                          {isPending && navigatingId === m.id && (
                            <span className="w-4 h-4 border-2 border-[var(--yes)] border-t-transparent rounded-full animate-spin shrink-0" />
                          )}
                          <Link href={`/admin/markets/${m.id}`}>{shortId(m.id)}</Link>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <Link href={`/admin/markets/${m.id}`}>
                          <p className="text-sm font-semibold text-[#2a3439] leading-snug group-hover:text-[var(--yes)] transition-colors">
                            {m.question_en}
                          </p>
                        </Link>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${catStyle}`}>
                          {m.category || "Other"}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        {m.amm ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] text-[#566166] font-medium">YES</span>
                              <span className="text-sm font-bold text-[var(--yes)]">
                                {Math.ceil(m.amm.current_yes_price * 100)}%
                              </span>
                            </div>
                            <div className="w-[1px] h-6 bg-[#a9b4b9]/20" />
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] text-[#566166] font-medium">NO</span>
                              <span className="text-sm font-bold text-[#566166]">
                                {Math.ceil(m.amm.current_no_price * 100)}%
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#a9b4b9] text-sm text-center block">—</span>
                        )}
                      </td>
                      <td className="px-6 py-5 text-right font-medium text-sm">
                        {m.amm ? formatCurrency(m.amm.total_volume) : "—"}
                      </td>
                      <td className="px-6 py-5 text-right text-sm text-[#566166]">
                        {m.amm ? m.amm.total_trades.toLocaleString() : "—"}
                      </td>
                      <td className="px-6 py-5">
                        <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
                          {statusConf.label}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                        {formatDate(m.created_at)}
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
              Showing <span className="font-bold text-[#2a3439]">{(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filtered.length)}</span> of{" "}
              <span className="font-bold text-[#2a3439]">{filtered.length}</span> markets
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
