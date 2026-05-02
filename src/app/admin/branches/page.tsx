import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { BranchesTable } from "@/components/admin/branches-table";
import type { BranchOverviewRow } from "@/types/branch";

export default async function AdminBranchesPage() {
  const supabase = await createClient();

  // Single RPC call — admin auth enforced at DB level
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBranches } = await (supabase as any).rpc("admin_list_branches");

  const rows: BranchOverviewRow[] = ((rawBranches as Record<string, unknown>[] | null) || []).map((b) => ({
    id: b.id as string,
    name: b.name as string,
    branch_code: b.branch_code as string,
    // book_type lands from mig 295 (admin_list_branches extended). Defaults to
    // 'reseller' for any row returned before 295 applies — preserves the
    // existing semantic (all pre-commission branches are reseller).
    book_type: (b.book_type as BranchOverviewRow["book_type"]) ?? "reseller",
    status: b.status as BranchOverviewRow["status"],
    pool_balance: Number(b.pool_balance),
    worst_case_total: Number(b.worst_case_total),
    pending_payouts: Number(b.pending_payouts),
    yes_markup_pct: Number(b.yes_markup_pct),
    no_markup_pct: Number(b.no_markup_pct),
    branch_fee_rate: Number(b.branch_fee_rate),
    display_mode: b.display_mode as string,
    cash_out_enabled: b.cash_out_enabled as boolean,
    payback_activated_at: b.payback_activated_at as string | null,
    created_at: b.created_at as string,
    updated_at: b.updated_at as string,
    manager_name: b.manager_name as string | null,
    manager_phone: b.manager_phone as string | null,
    manager_user_id: b.manager_user_id as string,
    user_count: Number(b.user_count),
    active_agent_count: Number(b.active_agent_count),
    trade_count: Number(b.trade_count),
    total_volume: Number(b.total_volume),
    total_revenue: Number(b.total_revenue),
    utilization_pct: Number(b.utilization_pct),
  }));

  // Aggregates for bottom cards
  const totalPool = rows.reduce((s, b) => s + b.pool_balance, 0);
  const totalVolume = rows.reduce((s, b) => s + b.total_volume, 0);
  const paybackCount = rows.filter((b) => b.status === "payback" || b.status === "frozen").length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Branches
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Manage branch operators, pools, solvency, and agent networks.
          </p>
        </div>
        <Link
          href="/admin/branches/create"
          className="bg-[var(--yes)] hover:bg-[var(--yes)]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Create Branch
        </Link>
      </div>

      {/* Branches Table */}
      <BranchesTable branches={rows} />

      {/* Bottom stat cards */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#e8eff3] p-6 rounded-xl flex flex-col justify-between h-40">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Branches</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{rows.length}</h3>
          </div>
          <p className="text-xs text-[#566166]">Combined pool: {formatCurrency(totalPool)}</p>
        </div>
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between h-40 border-l-4 border-[var(--yes)]">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Branch Volume</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{formatCurrency(totalVolume)}</h3>
          </div>
          <p className="text-xs text-[#566166]">All-time across all branches</p>
        </div>
        <div className="relative overflow-hidden bg-[#0b0f10] text-white p-6 rounded-xl flex flex-col justify-between h-40">
          <div className="relative z-10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Branches in Payback</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{paybackCount}</h3>
          </div>
          <div className="relative z-10 text-xs text-slate-300">
            {paybackCount === 0 ? "All branches healthy" : "Requires attention"}
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>
    </div>
  );
}
