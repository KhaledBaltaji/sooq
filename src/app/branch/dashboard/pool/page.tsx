import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, timeAgo } from "@/lib/utils";
import Link from "next/link";

const PAGE_SIZE = 25;

export default async function BranchPoolPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const params = await searchParams;
  const currentPage = Math.min(100000, Math.max(1, parseInt(params.page || "1", 10) || 1));
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Fetch one extra to know if there's a next page
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entries, count } = await sb
    .from("branch_pools")
    .select("*", { count: "exact" })
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1) as { data: Record<string, any>[] | null; count: number | null };

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  // PR 3 / migration 252: load owner summary for the pool-health card.
  // Includes pool_balance, worst_case_total, pending_liabilities (agent
  // commissions locked pending monthly unlock), effective_pool, solvency.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: summary } = await sb.rpc("get_branch_owner_summary", {
    p_branch_id: branch.id,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (summary as any) || null;

  const pendingLiabilities = Number(s?.pending_liabilities ?? 0);
  const worstCase = Number(s?.worst_case_total ?? branch.worst_case_total ?? 0);
  const poolBalance = Number(s?.pool_balance ?? branch.pool_balance ?? 0);
  const freeBalance = Math.max(0, poolBalance - worstCase - pendingLiabilities);
  const solvencyStatus: string = s?.solvency_status ?? "healthy";

  const TYPE_LABELS: Record<string, { label: string; color: string }> = {
    deposit: { label: "Deposit", color: "bg-emerald-100 text-emerald-800" },
    withdrawal: { label: "Withdrawal", color: "bg-red-100 text-red-700" },
    withdrawal_fee: { label: "Withdrawal Fee", color: "bg-amber-100 text-amber-800" },
    trade_in: { label: "Trade In", color: "bg-blue-100 text-blue-800" },
    trade_out: { label: "Trade Out", color: "bg-orange-100 text-orange-800" },
    adjustment: { label: "Adjustment", color: "bg-purple-100 text-purple-800" },
    resolution_payout: { label: "Resolution", color: "bg-[#dae2fd] text-[#4a5167]" },
    resolution_deficit: { label: "Deficit", color: "bg-red-100 text-red-700" },
    void_refund: { label: "Void Refund", color: "bg-amber-100 text-amber-800" },
    exit_fee: { label: "Exit Fee", color: "bg-emerald-100 text-emerald-800" },
    // PR 2 / migration 251 — branch-agent commission outflow
    agent_commission: { label: "Agent Commission", color: "bg-red-100 text-red-700" },
  };

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
            Pool Ledger
          </h2>
          <p className="text-[#566166]">All pool balance changes for your branch.</p>
        </div>
        <div className="bg-[#0b0f10] text-white px-6 py-4 rounded-xl">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current Pool</p>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{formatCurrency(poolBalance)}</p>
        </div>
      </div>

      {/* Pool Health — read-only. Only admins move money in/out of the pool. */}
      <div className="mb-10">
        <div className="bg-white rounded-xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#2a3439] uppercase tracking-widest">Pool Health</h3>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                solvencyStatus === "healthy"
                  ? "bg-emerald-100 text-emerald-800"
                  : solvencyStatus === "warning"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {solvencyStatus.replace("_", " ")}
            </span>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[#566166]">Pool balance</dt>
              <dd className="font-mono font-bold text-[#2a3439]">{formatCurrency(poolBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#566166]">Worst-case exposure</dt>
              <dd className="font-mono text-red-600">−{formatCurrency(worstCase)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#566166]">Pending agent liabilities</dt>
              <dd className="font-mono text-amber-700">−{formatCurrency(pendingLiabilities)}</dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-[#a9b4b9]/20">
              <dt className="font-bold text-[#2a3439]">Free (unreserved) balance</dt>
              <dd className="font-mono font-bold text-emerald-600">{formatCurrency(freeBalance)}</dd>
            </div>
          </dl>
          <p className="text-xs text-[#566166] mt-4 pt-4 border-t border-[#a9b4b9]/20">
            Pool movements are admin-controlled. Contact the platform admin to credit or debit your pool.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Amount</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Balance After</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Reference</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {(entries || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#566166]">No pool entries yet</td>
              </tr>
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (entries || []).map((e: Record<string, any>) => {
                const typeConf = TYPE_LABELS[e.type] || { label: e.type, color: "bg-gray-100 text-gray-700" };
                const amount = Number(e.amount || 0);
                return (
                  <tr key={e.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${typeConf.color}`}>
                        {typeConf.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono font-bold">
                      <span className={amount >= 0 ? "text-emerald-600" : "text-red-600"}>
                        {amount >= 0 ? "+" : ""}{formatCurrency(amount)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">
                      {formatCurrency(Number(e.balance_after || 0))}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-[#566166] max-w-[200px] truncate">
                      {e.reference_id ? `#${(e.reference_id as string).slice(0, 8)}` : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#566166]">
                      {timeAgo(e.created_at)}
                    </td>
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
            Page {currentPage} of {totalPages} ({count} entries)
          </p>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Link
                href={`/branch/dashboard/pool?page=${currentPage - 1}`}
                className="px-3 py-1.5 text-xs font-bold bg-white border border-[#a9b4b9]/30 rounded-lg hover:bg-[#f0f4f7] transition-colors"
              >
                Previous
              </Link>
            )}
            {currentPage < totalPages && (
              <Link
                href={`/branch/dashboard/pool?page=${currentPage + 1}`}
                className="px-3 py-1.5 text-xs font-bold bg-white border border-[#a9b4b9]/30 rounded-lg hover:bg-[#f0f4f7] transition-colors"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
