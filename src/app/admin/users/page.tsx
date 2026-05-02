import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { UsersTable } from "@/components/admin/users-table";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("users")
    .select("id, display_name, phone, balance_usd, agent_level, direct_referral_count, is_frozen, is_admin, total_wagered, created_at")
    .order("created_at", { ascending: false });

  const allUsers = (users || []) as any[];

  const { data: allUsersStats } = await supabase.from("users").select("balance_usd, total_wagered");
  const totalBalance = (allUsersStats || []).reduce((s: number, u: any) => s + Number(u.balance_usd || 0), 0);
  const totalWagered = (allUsersStats || []).reduce((s: number, u: any) => s + Number(u.total_wagered || 0), 0);
  const totalUserCount = (allUsersStats || []).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Users
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            User accounts and activity across the Sooq platform.
          </p>
        </div>
      </div>

      {/* Users Table */}
      <UsersTable users={allUsers} />

      {/* Bottom stat cards */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#e8eff3] p-6 rounded-xl flex flex-col justify-between h-40">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Users</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
              {totalUserCount.toLocaleString()}
            </h3>
          </div>
          <p className="text-xs text-[#566166]">Registered accounts</p>
        </div>
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between h-40 border-l-4 border-[var(--yes)]">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Balance</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
              {formatCurrency(totalBalance)}
            </h3>
          </div>
          <p className="text-xs text-[#566166]">Across all accounts</p>
        </div>
        <div className="relative overflow-hidden bg-[#0b0f10] text-white p-6 rounded-xl flex flex-col justify-between h-40">
          <div className="relative z-10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Wagered</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
              {formatCurrency(totalWagered)}
            </h3>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Platform lifetime
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>
    </div>
  );
}
