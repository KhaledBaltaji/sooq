// W2/W3/W4 strip: admin dashboard reduced to today's KPIs against surviving
// tables only. The original LMSR/branch/commission/system_logs activity feed
// is gone — its tables were dropped in W2/W3. The lean ops rebuild between
// W10 and W11 will add back a richer dashboard if needed.

import { createClient } from "@/lib/supabase/server";

export default async function AdminDashboard() {
  const supabase = await createClient();

  const todayISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [
    { count: speedTradesToday },
    { count: signupsToday },
    { count: depositsToday },
    { count: openSpeedMarkets },
    { count: pendingWithdrawals },
  ] = await Promise.all([
    supabase
      .from("speed_trades")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayISO),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayISO),
    supabase
      .from("deposits")
      .select("*", { count: "exact", head: true })
      .eq("status", "verified")
      .gte("created_at", todayISO),
    supabase
      .from("speed_markets")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("withdrawals")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const stats = {
    speedTrades: speedTradesToday ?? 0,
    signups: signupsToday ?? 0,
    deposits: depositsToday ?? 0,
    openMarkets: openSpeedMarkets ?? 0,
    pendingWithdrawals: pendingWithdrawals ?? 0,
  };

  return (
    <section className="p-8 space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Sooq Speed Admin
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Today&apos;s operational KPIs. Use the sidebar for detail views.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat icon="bolt" label="Speed Trades Today" value={stats.speedTrades} bg="bg-[#fef3c7]" iconColor="text-[#FFB800]" />
        <Stat icon="person_add" label="Signups Today" value={stats.signups} bg="bg-[#d1fae5]" iconColor="text-[#00E87B]" />
        <Stat icon="account_balance_wallet" label="Deposits Today" value={stats.deposits} bg="bg-[#dbeafe]" iconColor="text-[#2D8CFF]" />
        <Stat icon="analytics" label="Open Markets" value={stats.openMarkets} bg="bg-[#ede9fe]" iconColor="text-[#7c3aed]" />
        <Stat icon="output" label="Pending Withdrawals" value={stats.pendingWithdrawals} bg="bg-[#fee2e2]" iconColor="text-[#dc2626]" />
      </div>
    </section>
  );
}

function Stat({ icon, label, value, bg, iconColor }: {
  icon: string;
  label: string;
  value: number;
  bg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white p-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-center gap-4">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
        <span className={`material-symbols-outlined ${iconColor} text-xl`}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold font-[family-name:var(--font-manrope)] text-[#2a3439]">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#717c82]">{label}</p>
      </div>
    </div>
  );
}
