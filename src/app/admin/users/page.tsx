import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatCurrency } from "@/lib/utils";
import { UsersTable } from "@/components/admin/users-table";

export default async function AdminUsersPage() {
  const userRows = await db
    .select({
      id: users.id,
      display_name: users.displayName,
      phone: users.phone,
      balance_usd: users.balanceUsd,
      is_frozen: users.isFrozen,
      is_admin: users.isAdmin,
      created_at: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  // Cast numeric balance_usd to a number for the UsersTable.
  const allUsers = userRows.map((u) => ({
    ...u,
    balance_usd: Number(u.balance_usd ?? 0),
  }));

  // Lifetime totals — single aggregation query.
  const totals = await db
    .select({
      totalBalance: sql<string>`COALESCE(SUM(${users.balanceUsd}), 0)::text`,
      totalUserCount: sql<number>`COUNT(*)::int`,
    })
    .from(users);
  const totalBalance = Number(totals[0]?.totalBalance ?? 0);
  const totalUserCount = totals[0]?.totalUserCount ?? 0;

  return (
    <div className="p-8">
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

      <UsersTable users={allUsers} />

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
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
      </div>
    </div>
  );
}
