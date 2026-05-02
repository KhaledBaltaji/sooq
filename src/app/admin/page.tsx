// W2/W3/W4 strip + W7 cutover: admin dashboard reduced to today's KPIs
// against surviving tables only, queried via Drizzle. The lean ops rebuild
// between W10 and W11 will add back a richer dashboard if needed.

// RDS isn't reachable from Vercel's build pool (SG restricted to dev IP).
// `force-dynamic` keeps this page out of the static-generation pass.
export const dynamic = "force-dynamic";

import { sql, gte, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedTrades, speedMarkets, users, deposits, withdrawals } from "@/lib/db/schema";

async function countWhere(query: ReturnType<typeof db.select>) {
  const r = await query;
  return Number((r as unknown as { count: number }[])[0]?.count ?? 0);
}

export default async function AdminDashboard() {
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

  const [
    speedTradesTodayRows,
    signupsTodayRows,
    depositsTodayRows,
    openSpeedMarketsRows,
    pendingWithdrawalsRows,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedTrades)
      .where(gte(speedTrades.createdAt, startOfDay)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(gte(users.createdAt, startOfDay)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deposits)
      .where(and(eq(deposits.status, "verified"), gte(deposits.createdAt, startOfDay))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedMarkets)
      .where(eq(speedMarkets.status, "open")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(withdrawals)
      .where(eq(withdrawals.status, "pending")),
  ]);

  const stats = {
    speedTrades: speedTradesTodayRows[0]?.count ?? 0,
    signups: signupsTodayRows[0]?.count ?? 0,
    deposits: depositsTodayRows[0]?.count ?? 0,
    openMarkets: openSpeedMarketsRows[0]?.count ?? 0,
    pendingWithdrawals: pendingWithdrawalsRows[0]?.count ?? 0,
  };

  // countWhere is a no-op here — kept the inline `.where()` queries above for
  // type-safety. countWhere is exported in case future routes need it.
  void countWhere;

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
