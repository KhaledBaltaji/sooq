import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { FinanceTabs } from "@/components/admin/finance-tabs";
import { FinanceCreditButton } from "@/components/admin/finance-credit-button";

export default async function AdminFinancePage() {
  const supabase = await createClient();

  const [depositsRes, withdrawalsRes, transactionsRes, adminAdjustmentsRes] = await Promise.all([
    supabase
      .from("deposits")
      .select("*, users!inner(display_name, phone)")
      .order("created_at", { ascending: false }),
    supabase
      .from("withdrawals")
      .select("*, users!inner(display_name, phone)")
      .order("created_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("*, users!inner(display_name, phone)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("transactions")
      .select("id, user_id, type, amount, description, created_at, users!inner(display_name, phone)")
      .in("type", ["admin_credit", "admin_debit"])
      .order("created_at", { ascending: false }),
  ]);

  const deposits = depositsRes.data || [];
  const withdrawals = withdrawalsRes.data || [];
  const transactions = transactionsRes.data || [];
  const adminAdjustments = adminAdjustmentsRes.data || [];

  const confirmedDeposits = deposits.filter((d: any) => d.status === "confirmed");
  const approvedWithdrawals = withdrawals.filter((w: any) => w.status === "approved");
  const pendingDeposits = deposits.filter((d: any) => d.status === "pending" || d.status === "pending_review");
  const pendingWithdrawals = withdrawals.filter((w: any) => w.status === "pending");

  const adminCredits = adminAdjustments.filter((t: any) => t.type === "admin_credit");
  const adminDebits = adminAdjustments.filter((t: any) => t.type === "admin_debit");

  const totalDeposits =
    confirmedDeposits.reduce((s: number, d: any) => s + Number(d.net_amount), 0) +
    adminCredits.reduce((s: number, t: any) => s + Number(t.amount), 0);
  const totalWithdrawals =
    approvedWithdrawals.reduce((s: number, w: any) => s + Number(w.amount), 0) +
    adminDebits.reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0);
  const pendingCount = pendingDeposits.length + pendingWithdrawals.length;
  const netFlow = totalDeposits - totalWithdrawals;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Finance
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Monitor deposits, withdrawals, and all platform transactions.
          </p>
        </div>
        <FinanceCreditButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-emerald-600 text-lg">arrow_downward</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Deposits</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{formatCurrency(totalDeposits)}</p>
          <p className="text-xs text-[#566166] mt-1">
            {adminCredits.length > 0
              ? `${confirmedDeposits.length} confirmed + ${adminCredits.length} admin`
              : `${confirmedDeposits.length} confirmed deposits`}
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-red-500 text-lg">arrow_upward</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Withdrawals</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{formatCurrency(totalWithdrawals)}</p>
          <p className="text-xs text-[#566166] mt-1">
            {adminDebits.length > 0
              ? `${approvedWithdrawals.length} approved + ${adminDebits.length} admin`
              : `${approvedWithdrawals.length} approved withdrawals`}
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#fff3cd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#856404] text-lg">schedule</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Pending Requests</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{pendingCount}</p>
          <p className="text-xs text-[#566166] mt-1">awaiting review</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-blue-600 text-lg">swap_vert</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Net Flow</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${netFlow >= 0 ? "text-emerald-600" : "text-[var(--error)]"}`}>
            {netFlow >= 0 ? "+" : ""}{formatCurrency(Math.abs(netFlow))}
          </p>
          <p className="text-xs text-[#566166] mt-1">platform net inflow</p>
        </div>
      </div>

      {/* Tabs */}
      <FinanceTabs
        deposits={deposits as any}
        withdrawals={withdrawals as any}
        transactions={transactions as any}
        adminAdjustments={adminAdjustments as any}
        pendingCount={pendingCount}
      />
    </div>
  );
}
