import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { isSuperAdmin } from "@/lib/admin-views";
import { UserActions } from "@/components/admin/user-actions";
import { QuickCreditButton } from "@/components/admin/quick-credit-button";
import { QuickAgentCreditButton } from "@/components/admin/quick-agent-credit-button";

const LEVEL_STYLES: Record<number, string> = {
  1: "bg-[#e8eff3] text-[#566166]",
  2: "bg-[var(--yes)]/10 text-[var(--yes)]",
  3: "bg-[var(--warning)]/10 text-[var(--warning)]",
  4: "bg-[var(--success)]/10 text-[var(--success)]",
};

interface ReferralUser {
  id: string;
  display_name: string | null;
  phone: string | null;
  agent_level: number;
  balance_usd: number;
  direct_referral_count: number;
  is_admin: boolean;
  is_frozen: boolean;
  created_at: string;
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: user } = await supabase.from("users").select("*").eq("id", id).single();
  if (!user) notFound();

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: trades } = await supabase
    .from("trades")
    .select("*, markets(question_en, status, outcome)")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: speedTrades } = await supabase
    .from("speed_trades")
    .select("id, market_id, kind, amount, spot_price, fair_prob, offered_prob, handle_fee, created_at, speed_markets(asset, duration, strike_price, status, outcome)")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Fetch direct referrals (users referred BY this user)
  const { data: directReferrals } = await supabase
    .from("users")
    .select("id, display_name, phone, agent_level, balance_usd, direct_referral_count, is_admin, is_frozen, created_at")
    .eq("referred_by", id)
    .order("created_at", { ascending: false });

  // Fetch sub-referrals (level 2) — users referred by the direct referrals
  const directIds = (directReferrals || []).map((r) => r.id);
  let subReferrals: ReferralUser[] = [];
  if (directIds.length > 0) {
    const { data } = await supabase
      .from("users")
      .select("id, display_name, phone, agent_level, balance_usd, direct_referral_count, is_admin, is_frozen, created_at, referred_by")
      .in("referred_by", directIds)
      .order("created_at", { ascending: false });
    subReferrals = (data || []) as any;
  }

  // Build a map of parent -> children for level 2
  const subReferralMap = new Map<string, typeof subReferrals>();
  for (const sub of subReferrals) {
    const parentId = (sub as any).referred_by;
    if (!subReferralMap.has(parentId)) subReferralMap.set(parentId, []);
    subReferralMap.get(parentId)!.push(sub);
  }

  // Referral chain (ancestors)
  const chainUsers: any[] = [];
  if (user.referral_chain && (user.referral_chain as string[]).length > 0) {
    const { data } = await supabase
      .from("users")
      .select("id, display_name, phone, agent_level")
      .in("id", user.referral_chain as string[]);
    if (data) chainUsers.push(...data);
  }

  const { data: ledgerSum } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", id)
    .not("type", "in", "(commission,agent_transfer_out)");
  const ledgerBalance = (ledgerSum || []).reduce((s: number, t: any) => s + Number(t.amount), 0);

  const u = user as any;
  const balanceMismatch = Math.abs(u.balance_usd - ledgerBalance) > 0.01;
  const levelStyle = LEVEL_STYLES[u.agent_level] || LEVEL_STYLES[1];
  const isAdmin = u.is_admin;

  return (
    <div className="p-8 space-y-8">
      {/* Back Button */}
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to Users
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-4">
            <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
              {u.display_name || u.phone || "Anonymous"}
            </h2>
            {/* Prominent role badge */}
            <span className={`text-xs font-bold px-3 py-1.5 rounded-lg uppercase tracking-wide ${
              isAdmin
                ? isSuperAdmin(u.admin_allowed_views)
                  ? "bg-[var(--yes)] text-white"
                  : "bg-[var(--yes)]/10 text-[var(--yes)]"
                : "bg-[#e8eff3] text-[#566166]"
            }`}>
              {isAdmin
                ? isSuperAdmin(u.admin_allowed_views)
                  ? "Super Admin"
                  : `Sub-Admin (${(u.admin_allowed_views || []).length} pages)`
                : "User"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${levelStyle}`}>
              L{u.agent_level}
            </span>
            {u.agent_activated ? (
              <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-[var(--success)]/10 text-[var(--success)]">
                Activated
              </span>
            ) : u.agent_activation_override ? (
              <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-[var(--warning)]/10 text-[var(--warning)]">
                Override
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-[#e8eff3] text-[#566166]">
                {u.qualified_referral_count}/5 Qualified
              </span>
            )}
            {u.is_frozen && (
              <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-[var(--error)]/10 text-[var(--error)]">
                Frozen
              </span>
            )}
            <span className="text-xs font-mono text-[#a9b4b9]">{u.id}</span>
          </div>
          {u.phone && u.display_name && (
            <p className="text-sm text-[#566166] mt-2">{u.phone}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <QuickCreditButton user={{ id, display_name: u.display_name, phone: u.phone, balance_usd: u.balance_usd }} />
          <QuickAgentCreditButton user={{ id, display_name: u.display_name, phone: u.phone, agent_balance_usd: Number(u.agent_balance_usd ?? 0) }} />
          <UserActions
            userId={id}
            isFrozen={u.is_frozen}
            agentActivated={u.agent_activated}
            activationOverride={u.agent_activation_override}
          />
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-6">
        <div className="bg-white p-6 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Balance
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">payments</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)]">
            {formatCurrency(u.balance_usd)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl border-l-4 border-indigo-500">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Agent Wallet
            </h4>
            <span className="material-symbols-outlined text-indigo-500 text-lg">account_balance_wallet</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)] text-indigo-700">
            {formatCurrency(Number(u.agent_balance_usd ?? 0))}
          </p>
          <p className="text-[10px] text-[#717c82] mt-1">Commissions (separate from trading)</p>
        </div>
        <div className={`bg-white p-6 rounded-xl ${balanceMismatch ? "border-l-4 border-[var(--error)]" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Verified Balance
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">menu_book</span>
          </div>
          <p className={`text-2xl font-bold font-[family-name:var(--font-manrope)] ${balanceMismatch ? "text-[var(--error)]" : ""}`}>
            {formatCurrency(ledgerBalance)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Total Wagered
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">trending_up</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)]">
            {formatCurrency(u.total_wagered)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Direct Referrals
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">group</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)]">
            {u.direct_referral_count}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#717c82] font-[family-name:var(--font-inter)]">
              Qualified Referrals
            </h4>
            <span className="material-symbols-outlined text-[#a9b4b9] text-lg">how_to_reg</span>
          </div>
          <p className="text-2xl font-bold font-[family-name:var(--font-manrope)]">
            {u.qualified_referral_count ?? 0}<span className="text-sm font-medium text-[#a9b4b9]">/5</span>
          </p>
        </div>
      </div>

      {/* Referral Chain (Ancestors — who referred this user) */}
      {u.referral_chain && (u.referral_chain as string[]).length > 0 && (
        <div className="bg-white rounded-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-[#a9b4b9]">family_history</span>
            <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)]">Referred By</h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {(u.referral_chain as string[]).map((ancestorId: string, i: number) => {
              const ancestor = chainUsers.find((c: any) => c.id === ancestorId);
              return (
                <div key={ancestorId} className="flex items-center gap-3">
                  {i > 0 && <span className="text-[#a9b4b9] text-lg">&rarr;</span>}
                  <Link
                    href={`/admin/users/${ancestorId}`}
                    className="bg-[#f0f4f7] p-3 px-4 rounded-lg hover:bg-[#e8eff3] transition-colors"
                  >
                    <p className="text-xs font-medium text-[#2a3439]">
                      {ancestor?.display_name || ancestor?.phone || ancestorId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-[#717c82]">
                      Tier {i + 1} &middot; L{ancestor?.agent_level || "?"}
                    </p>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Referral Network (Clients — users this person referred) */}
      <div className="bg-white rounded-xl p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#a9b4b9]">account_tree</span>
            <div>
              <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)]">Referral Network</h3>
              <p className="text-xs text-[#717c82] mt-0.5">
                {(directReferrals || []).length} direct client{(directReferrals || []).length !== 1 ? "s" : ""}
                {subReferrals.length > 0 && ` · ${subReferrals.length} sub-referral${subReferrals.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
        </div>

        {(directReferrals || []).length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">person_off</span>
            <p className="text-sm font-medium text-[#566166]">No referrals yet</p>
            <p className="text-xs text-[#a9b4b9] mt-1">This user hasn&apos;t referred anyone</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(directReferrals || []).map((ref) => {
              const refLevel = LEVEL_STYLES[ref.agent_level] || LEVEL_STYLES[1];
              const children = subReferralMap.get(ref.id) || [];

              return (
                <div key={ref.id}>
                  {/* Direct referral row */}
                  <Link
                    href={`/admin/users/${ref.id}`}
                    className="flex items-center justify-between p-4 rounded-lg bg-[#f0f4f7] hover:bg-[#e8eff3] transition-colors group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 bg-[var(--yes)]/10 rounded-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-[var(--yes)] text-sm">person</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#2a3439] group-hover:text-[var(--yes)] transition-colors">
                          {ref.display_name || ref.phone || "Anonymous"}
                        </p>
                        <p className="text-xs text-[#717c82]">
                          {ref.phone && ref.display_name ? ref.phone : ""}
                          {ref.phone && ref.display_name ? " · " : ""}
                          Joined {new Date(ref.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-[#717c82]">Balance</p>
                        <p className="text-sm font-bold font-[family-name:var(--font-manrope)] tabular-nums">{formatCurrency(ref.balance_usd)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#717c82]">Referrals</p>
                        <p className="text-sm font-bold font-[family-name:var(--font-manrope)] tabular-nums">{ref.direct_referral_count}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${refLevel}`}>
                        L{ref.agent_level}
                      </span>
                      {ref.is_frozen && (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-[var(--error)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)]" />
                          FROZEN
                        </div>
                      )}
                      <span className="material-symbols-outlined text-[#a9b4b9] text-sm group-hover:text-[var(--yes)] transition-colors">
                        chevron_right
                      </span>
                    </div>
                  </Link>

                  {/* Sub-referrals (level 2) */}
                  {children.length > 0 && (
                    <div className="ml-12 mt-1 space-y-1">
                      {children.map((sub) => {
                        const subLevel = LEVEL_STYLES[sub.agent_level] || LEVEL_STYLES[1];
                        return (
                          <Link
                            key={sub.id}
                            href={`/admin/users/${sub.id}`}
                            className="flex items-center justify-between p-3 rounded-lg hover:bg-[#f0f4f7] transition-colors group border-l-2 border-[#a9b4b9]/20 pl-5"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 bg-[#e8eff3] rounded-full flex items-center justify-center">
                                <span className="material-symbols-outlined text-[#717c82] text-xs">person</span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-[#2a3439] group-hover:text-[var(--yes)] transition-colors">
                                  {sub.display_name || sub.phone || "Anonymous"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-xs text-[#566166] tabular-nums">{formatCurrency(sub.balance_usd)}</span>
                              <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${subLevel}`}>
                                L{sub.agent_level}
                              </span>
                              {sub.direct_referral_count > 0 && (
                                <span className="text-[10px] text-[#717c82]">
                                  +{sub.direct_referral_count} refs
                                </span>
                              )}
                              <span className="material-symbols-outlined text-[#a9b4b9] text-sm group-hover:text-[var(--yes)] transition-colors">
                                chevron_right
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
              {(transactions || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">receipt_long</span>
                    <p className="text-sm font-medium text-[#566166]">No transactions yet</p>
                  </td>
                </tr>
              ) : (
                (transactions || []).map((tx: any, i: number) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                  >
                    <td className="px-6 py-5 text-sm text-[#2a3439] capitalize">{tx.type}</td>
                    <td className={`px-6 py-5 text-right text-sm font-medium tabular-nums ${tx.amount > 0 ? "text-[var(--success)]" : "text-[#2a3439]"}`}>
                      {tx.amount > 0 ? "+" : ""}{formatCurrency(Math.abs(tx.amount))}
                    </td>
                    <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                      {formatCurrency(tx.balance_after)}
                    </td>
                    <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Trades */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5 border-b border-[#a9b4b9]/10">
          <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)]">Recent Trades</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7] text-left">
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest min-w-[200px]">Market</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest">Side</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[11px] font-bold text-[#566166] uppercase tracking-widest text-right">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {(trades || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">casino</span>
                    <p className="text-sm font-medium text-[#566166]">No trades yet</p>
                  </td>
                </tr>
              ) : (
                (trades || []).map((trade: any, i: number) => (
                  <tr
                    key={trade.id}
                    className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                  >
                    <td className="px-6 py-5 text-sm font-semibold text-[#2a3439] max-w-[200px] truncate">
                      {trade.markets?.question_en || "—"}
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${
                          trade.side === "yes"
                            ? "bg-[var(--yes)]/10 text-[var(--yes)]"
                            : "bg-[#e8eff3] text-[#566166]"
                        }`}
                      >
                        {trade.direction === "sell" ? "SELL " : ""}{trade.side?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right text-sm font-medium tabular-nums text-[#2a3439]">
                      {formatCurrency(trade.total_cost)}
                    </td>
                    <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                      {trade.price_per_share ? `${Math.round(Number(trade.price_per_share) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))
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
              {(speedTrades || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">bolt</span>
                    <p className="text-sm font-medium text-[#566166]">No speed bets yet</p>
                  </td>
                </tr>
              ) : (
                /* eslint-disable @typescript-eslint/no-explicit-any */
                (speedTrades as any[]).map((trade, i) => (
                  <tr
                    key={trade.id}
                    className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                  >
                    <td className="px-6 py-5 text-sm font-semibold text-[#2a3439]">
                      {trade.speed_markets?.asset ?? "BTC"} {trade.speed_markets?.duration ?? ""}
                      <span className="block text-[11px] text-[#717c82] font-normal">
                        Strike ${Number(trade.speed_markets?.strike_price ?? 0).toFixed(0)}
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
                      ${Number(trade.spot_price).toFixed(0)}
                    </td>
                    <td className="px-6 py-5 text-right text-sm tabular-nums text-[#717c82]">
                      {new Date(trade.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
