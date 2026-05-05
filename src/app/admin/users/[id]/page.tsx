// W3 + W7 strip: detail page reduced to v1-relevant fields only.
// Removed: agent levels, referral tree, total_wagered, qualified-referral
// gates, the LMSR `trades` table.

// RDS isn't reachable from Vercel's build pool — render per-request.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, transactions, speedTrades, speedMarkets } from "@/lib/db/schema";
import { formatCurrency } from "@/lib/utils";
import { isSuperAdmin } from "@/lib/admin-views";
import { UserActions } from "@/components/admin/user-actions";
import { QuickCreditButton } from "@/components/admin/quick-credit-button";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userRows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = userRows[0];
  if (!u) notFound();

  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, id))
    .orderBy(desc(transactions.createdAt))
    .limit(20);

  const speedTradeRows = await db
    .select({
      id: speedTrades.id,
      kind: speedTrades.kind,
      amount: speedTrades.amount,
      spotPrice: speedTrades.spotPrice,
      createdAt: speedTrades.createdAt,
      asset: speedMarkets.asset,
      duration: speedMarkets.duration,
      strikePrice: speedMarkets.strikePrice,
    })
    .from(speedTrades)
    .leftJoin(speedMarkets, eq(speedTrades.marketId, speedMarkets.id))
    .where(eq(speedTrades.userId, id))
    .orderBy(desc(speedTrades.createdAt))
    .limit(20);

  // Verified balance — sum of non-admin-debit ledger entries.
  const ledgerSumRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)::text`,
    })
    .from(transactions)
    .where(
      sql`${transactions.userId} = ${id} AND ${transactions.type} != 'admin_debit'`
    );
  void ne; // keep import for later use; current build path doesn't need it

  const ledgerBalance = Number(ledgerSumRows[0]?.total ?? 0);
  const balance = Number(u.balanceUsd ?? 0);
  const balanceMismatch = Math.abs(balance - ledgerBalance) > 0.01;

  return (
    <div className="p-8 space-y-8">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to Users
      </Link>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-4">
            <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
              {u.displayName || u.phone || "Anonymous"}
            </h2>
            <span
              className={`text-xs font-bold px-3 py-1.5 rounded-lg uppercase tracking-wide ${
                u.isAdmin
                  ? isSuperAdmin(u.adminAllowedViews)
                    ? "bg-[var(--yes)] text-white"
                    : "bg-[var(--yes)]/10 text-[var(--yes)]"
                  : "bg-[#e8eff3] text-[#566166]"
              }`}
            >
              {u.isAdmin
                ? isSuperAdmin(u.adminAllowedViews)
                  ? "Super Admin"
                  : `Sub-Admin (${(u.adminAllowedViews || []).length} pages)`
                : "User"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-3">
            {u.isFrozen && (
              <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-[var(--error)]/10 text-[var(--error)]">
                Frozen
              </span>
            )}
            <span className="text-xs font-mono text-[#a9b4b9]">{u.id}</span>
          </div>
          {u.phone && u.displayName && (
            <p className="text-sm text-[#566166] mt-2">{u.phone}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <QuickCreditButton
            user={{
              id,
              display_name: u.displayName,
              phone: u.phone,
              balance_usd: balance,
            }}
          />
          <UserActions userId={id} isFrozen={u.isFrozen} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Balance
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">payments</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)]">
            {formatCurrency(balance)}
          </p>
        </div>
        <div className={`bg-white p-6 rounded-xl ${balanceMismatch ? "border-l-4 border-[var(--error)]" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Verified Balance
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">menu_book</span>
          </div>
          <p
            className={`text-2xl font-bold font-[family-name:var(--font-manrope)] ${
              balanceMismatch ? "text-[var(--error)]" : ""
            }`}
          >
            {formatCurrency(ledgerBalance)}
          </p>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5 border-b border-[#a9b4b9]/10">
          <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)]">Recent Transactions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7] text-left">
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Balance After</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {txRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">receipt_long</span>
                    <p className="text-sm font-medium text-[#566166]">No transactions yet</p>
                  </td>
                </tr>
              ) : (
                txRows.map((tx, i) => {
                  const amount = Number(tx.amount);
                  return (
                    <tr key={tx.id} className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}>
                      <td className="px-6 py-5 text-sm text-[#2a3439] capitalize">{tx.type}</td>
                      <td className={`px-6 py-5 text-right text-sm font-medium tabular-nums ${amount > 0 ? "text-[var(--success)]" : "text-[#2a3439]"}`}>
                        {amount > 0 ? "+" : ""}
                        {formatCurrency(Math.abs(amount))}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                        {formatCurrency(Number(tx.balanceAfter))}
                      </td>
                      <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                        <div>{tx.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                        <div className="text-xs text-[#a3aaaf] tabular-nums">
                          {tx.createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Speed Bets */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5 border-b border-[#a9b4b9]/10 flex items-center gap-2">
          <span className="material-symbols-outlined text-[#F7931A]">bolt</span>
          <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)]">Recent Speed Bets</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7] text-left">
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Market</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Kind</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Spot</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {speedTradeRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">bolt</span>
                    <p className="text-sm font-medium text-[#566166]">No speed bets yet</p>
                  </td>
                </tr>
              ) : (
                speedTradeRows.map((trade, i) => (
                  <tr key={trade.id} className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}>
                    <td className="px-6 py-5 text-sm font-semibold text-[#2a3439]">
                      {trade.asset ?? "BTC"} {trade.duration ?? ""}
                      <span className="block text-[11px] text-[#717c82] font-normal">
                        Strike ${Number(trade.strikePrice ?? 0).toFixed(0)}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${
                        trade.kind === "open"
                          ? "bg-[var(--yes)]/10 text-[var(--yes)]"
                          : "bg-amber-500/10 text-amber-600"
                      }`}>
                        {trade.kind}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right text-sm font-medium tabular-nums text-[#2a3439]">
                      {formatCurrency(Number(trade.amount))}
                    </td>
                    <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                      ${Number(trade.spotPrice).toFixed(0)}
                    </td>
                    <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                      {trade.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
