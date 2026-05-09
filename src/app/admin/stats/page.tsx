// Admin stats / revenue dashboard.
// Server-rendered shell + auth gate; the live dashboard is the client
// component below. KPIs + per-market P&L table + per-user tabs.

export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth/guards";
import { StatsClient } from "@/components/admin/stats-client";

export default async function AdminStatsPage() {
  await requireAdmin();
  return (
    <div className="p-8 space-y-6">
      <header>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Stats
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          Four tabs, one job each. <strong>Revenue</strong> for stakes /
          payouts / per-market P&amp;L. <strong>Money</strong> for deposits /
          withdrawals / balance held. <strong>Users</strong> for DAU + the
          leaderboard. <strong>Health</strong> for oracle / matrix coverage /
          CLV / pricing telemetry.
        </p>
      </header>
      <StatsClient />
    </div>
  );
}
