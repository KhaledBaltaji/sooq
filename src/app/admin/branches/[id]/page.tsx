import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { BranchActions } from "@/components/admin/branch-actions";
import { BranchFeeRateEditor } from "@/components/admin/branch-fee-rate-editor";
import { SpeedBranchControls } from "@/components/admin/speed-branch-controls";
import { SolvencyCard } from "@/components/solvency-card";
import { BRANCH_STATUS_CONFIG, SOLVENCY_STATUS_CONFIG, BRANCH_BOOK_TYPE_CONFIG } from "@/types/branch";
import type { BranchStatus, BranchSolvency, BranchDashboardStats, BranchBookType } from "@/types/branch";

export default async function AdminBranchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Branch tables are not yet in database.ts (pending full type regeneration).
  // Use type assertions for branch-specific queries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Fetch branch
  const { data: branch } = await sb.from("branches").select("*").eq("id", id).single() as { data: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!branch) notFound();

  // Fetch solvency check
  const { data: solvencyRaw } = await sb.rpc("branch_solvency_check", { p_branch_id: id });
  const solvency = (solvencyRaw as BranchSolvency | null);

  // Fetch dashboard stats
  const { data: statsRaw } = await sb.rpc("branch_dashboard_stats", { p_branch_id: id });
  const stats = (statsRaw as BranchDashboardStats | null);

  // Fetch manager
  const { data: manager } = await supabase.from("users").select("id, display_name, phone").eq("id", branch.manager_user_id as string).single();

  // Fetch agents
  const { data: agents } = await sb.from("branch_agents").select("*").eq("branch_id", id).order("created_at", { ascending: false }) as { data: Record<string, any>[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Get agent user names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentUserIds = [...new Set((agents || []).map((a: Record<string, any>) => a.user_id as string))];
  const { data: agentUsers } = agentUserIds.length > 0
    ? await supabase.from("users").select("id, display_name, phone").in("id", agentUserIds)
    : { data: [] };
  const agentUserMap = new Map<string, { display_name: string | null; phone: string | null }>();
  for (const u of agentUsers || []) {
    agentUserMap.set(u.id, { display_name: u.display_name, phone: u.phone });
  }

  // Fetch revenue per market
  const { data: revenues } = await sb.from("branch_revenue").select("*").eq("branch_id", id).order("created_at", { ascending: false }).limit(20) as { data: Record<string, any>[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Get market names for revenue
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revenueMarketIds = [...new Set((revenues || []).map((r: Record<string, any>) => r.market_id as string))];
  const { data: revenueMarkets } = revenueMarketIds.length > 0
    ? await supabase.from("markets").select("id, question_en").in("id", revenueMarketIds)
    : { data: [] };
  const marketNameMap = new Map<string, string>();
  for (const m of revenueMarkets || []) {
    marketNameMap.set(m.id, m.question_en || "Unknown");
  }

  // Fetch last webhook delivery
  const { data: lastWebhook } = await sb.from("system_logs")
    .select("message, context, created_at")
    .eq("source", "webhook/branch-resolution")
    .filter("context->>branch_id", "eq", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single() as { data: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Fetch pool ledger (last 20)
  const { data: poolEntries } = await sb.from("branch_pools").select("*").eq("branch_id", id).order("created_at", { ascending: false }).limit(20) as { data: Record<string, any>[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Fetch admin overrides (last 10)
  const { data: overrides } = await sb.from("branch_admin_overrides").select("*").eq("branch_id", id).order("created_at", { ascending: false }).limit(10) as { data: Record<string, any>[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Speed-markets sidecar row (null if branch hasn't been speed-enabled yet)
  const { data: speedRow } = await sb.from("speed_branches").select("*").eq("branch_id", id).maybeSingle() as { data: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: speedLedger } = await sb.from("speed_pool_ledger").select("id, type, amount, balance_after, description, created_at").eq("branch_id", id).order("created_at", { ascending: false }).limit(20) as { data: Record<string, any>[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

  const statusConf = BRANCH_STATUS_CONFIG[branch.status as BranchStatus] || BRANCH_STATUS_CONFIG.active;
  const solvencyConf = solvency ? SOLVENCY_STATUS_CONFIG[solvency.status] || SOLVENCY_STATUS_CONFIG.green : SOLVENCY_STATUS_CONFIG.green;

  const shortId = (uid: string) => `#${uid.slice(0, 6).toUpperCase()}`;

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      {/* Breadcrumbs & Header */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-[#566166]">
          <Link href="/admin/branches" className="hover:text-[var(--yes)] transition-colors">Branches</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-[#2a3439] font-semibold">{branch.name}</span>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold ml-3 ${statusConf.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
            {statusConf.label}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
                {branch.name}
              </h2>
              {(() => {
                const bt = (branch.book_type ?? "reseller") as BranchBookType;
                const tc = BRANCH_BOOK_TYPE_CONFIG[bt];
                return (
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tc.badgeClass}`}>
                    {tc.label}
                  </span>
                );
              })()}
            </div>
            <p className="text-[#566166]">
              Code: <span className="font-mono font-bold">{branch.branch_code}</span>
              {manager && (
                <span className="ml-4">Manager: <span className="font-semibold">{manager.display_name || manager.phone}</span></span>
              )}
            </p>
          </div>

          <BranchActions branchId={id} status={branch.status as BranchStatus} />
        </div>
      </section>

      {/* Solvency Card + Config Card */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <SolvencyCard solvency={solvency} solvencyConf={solvencyConf} />

        {/* Config Card */}
        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-8">
            <span className="material-symbols-outlined text-[#566166]">settings</span>
            <h4 className="font-bold tracking-tight text-[#566166]">Branch Configuration</h4>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">YES Markup</p>
              <p className="text-sm font-bold text-[#2a3439]">{(Number(branch.yes_markup_pct) * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">NO Markup</p>
              <p className="text-sm font-bold text-[#2a3439]">{(Number(branch.no_markup_pct) * 100).toFixed(1)}%</p>
            </div>
            <BranchFeeRateEditor branchId={id} currentRate={Number(branch.branch_fee_rate)} />
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Exit Fee</p>
              <p className="text-sm font-bold text-[#2a3439]">{(Number(branch.exit_fee_pct) * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Display Mode</p>
              <p className="text-sm font-bold text-[#2a3439] capitalize">{branch.display_mode}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Cash Out</p>
              <p className={`text-sm font-bold ${branch.cash_out_enabled ? "text-emerald-600" : "text-red-600"}`}>
                {branch.cash_out_enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Created</p>
              <p className="text-sm text-[#2a3439]">{new Date(branch.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            </div>
            {branch.payback_activated_at && (
              <div>
                <p className="text-[10px] text-amber-600 uppercase font-bold tracking-widest mb-1">Payback Since</p>
                <p className="text-sm font-bold text-amber-600">{timeAgo(branch.payback_activated_at)}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Branch ID</p>
              <p className="text-sm font-mono text-[#2a3439]">{branch.id}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Webhook Card */}
      <section className="bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-6">
          <span className="material-symbols-outlined text-[#566166]">webhook</span>
          <h4 className="font-bold tracking-tight text-[#566166]">Webhook Configuration</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">URL</p>
            <p className="text-sm text-[#2a3439] font-mono break-all">
              {branch.webhook_url || <span className="text-[#566166] italic font-sans">Not configured</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Secret</p>
            <p className="text-sm text-[#2a3439] font-mono">
              {branch.webhook_secret
                ? `${"••••••••" + (branch.webhook_secret as string).slice(-4)}`
                : <span className="text-[#566166] italic font-sans">Not set</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Last Delivery</p>
            {lastWebhook ? (
              <div>
                <p className="text-sm text-[#2a3439]">{lastWebhook.message}</p>
                <p className="text-[10px] text-[#566166] mt-0.5">{timeAgo(lastWebhook.created_at)}</p>
              </div>
            ) : (
              <p className="text-sm text-[#566166] italic">No deliveries yet</p>
            )}
          </div>
        </div>
      </section>

      {/* Stat Cards Row — fields vary by book_type */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-6">
        <StatCard label="Pool Balance" value={formatCurrency(Number(branch.pool_balance))} />
        <StatCard label="Users" value={stats?.user_count?.toString() || "0"} />
        <StatCard label="Active Agents" value={stats?.active_agent_count?.toString() || "0"} />
        <StatCard
          label="Total Volume"
          value={formatCurrency(stats?.book_type === "reseller" ? stats.total_volume : 0)}
        />
        <StatCard
          label="Total Revenue"
          value={formatCurrency(stats?.book_type === "reseller" ? stats.total_revenue : 0)}
        />
      </section>

      {/* Agents Table */}
      {agents && agents.length > 0 && (
        <section className="space-y-4">
          <h4 className="font-bold tracking-tight text-lg text-[#2a3439]">Agents</h4>
          <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f0f4f7]">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Agent</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Rate</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Cumulative P/L</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Referral Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#a9b4b9]/10">
                {agents.map((a) => {
                  const aUser = agentUserMap.get(a.user_id);
                  return (
                    <tr key={a.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-[#2a3439]">
                        {aUser?.display_name || aUser?.phone || shortId(a.user_id)}
                        {a.parent_agent_id && <span className="text-xs text-[#566166] ml-2">(sub-agent)</span>}
                      </td>
                      <td className="px-6 py-4">
                        {a.agent_type ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            a.agent_type === "pl" ? "bg-[#dae2fd] text-[#4a5167]" : "bg-emerald-100 text-emerald-800"
                          }`}>
                            {a.agent_type === "pl" ? "P/L" : "Commission"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">Pending</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#2a3439]">{a.rate != null ? `${(Number(a.rate) * 100).toFixed(1)}%` : "—"}</td>
                      <td className="px-6 py-4 text-sm font-bold">
                        <span className={Number(a.cumulative_pl) >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {Number(a.cumulative_pl) >= 0 ? "+" : ""}{formatCurrency(Number(a.cumulative_pl))}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-bold ${
                          a.status === "approved" ? "text-emerald-600" :
                          a.status === "pending" ? "text-amber-600" :
                          a.status === "rejected" ? "text-red-600" :
                          "text-[#566166]"
                        }`}>
                          {a.status ? a.status.charAt(0).toUpperCase() + a.status.slice(1) : (a.is_active ? "Active" : "Inactive")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-[#566166]">{a.referral_code || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Revenue Table */}
      {revenues && revenues.length > 0 && (
        <section className="space-y-4">
          <h4 className="font-bold tracking-tight text-lg text-[#2a3439]">Revenue by Market</h4>
          <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f0f4f7]">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Market</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Markup</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Explicit Fee</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Exit Fee</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Resolution Fee</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">SOOQ Fee</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#a9b4b9]/10">
                {revenues.map((r) => (
                  <tr key={r.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-[#2a3439] max-w-[200px] truncate">
                      {marketNameMap.get(r.market_id) || shortId(r.market_id)}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(Number(r.markup_revenue))}</td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(Number(r.explicit_fee_revenue))}</td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(Number(r.exit_fee_revenue))}</td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(Number(r.resolution_fee_revenue))}</td>
                    <td className="px-6 py-4 text-sm text-red-500">-{formatCurrency(Number(r.sooq_fee_revenue || 0))}</td>
                    <td className="px-6 py-4 text-sm font-bold text-[#2a3439]">{formatCurrency(Number(r.total_revenue))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pool Ledger */}
      <section className="space-y-4">
        <h4 className="font-bold tracking-tight text-lg text-[#2a3439]">Pool Ledger (Recent)</h4>
        <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7]">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Balance After</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {(!poolEntries || poolEntries.length === 0) ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">account_balance</span>
                    <p className="text-sm font-medium text-[#566166]">No pool entries yet</p>
                  </td>
                </tr>
              ) : (
                poolEntries.map((e) => (
                  <tr key={e.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        Number(e.amount) >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}>
                        {e.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold">
                      <span className={Number(e.amount) >= 0 ? "text-emerald-600" : "text-red-600"}>
                        {Number(e.amount) >= 0 ? "+" : ""}{formatCurrency(Number(e.amount))}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">{formatCurrency(Number(e.balance_after))}</td>
                    <td className="px-6 py-4 text-xs text-[#566166]">{timeAgo(e.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin Overrides */}
      {overrides && overrides.length > 0 && (
        <section className="space-y-4">
          <h4 className="font-bold tracking-tight text-lg text-[#2a3439]">Admin Overrides</h4>
          <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f0f4f7]">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Note</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#a9b4b9]/10">
                {overrides.map((o) => (
                  <tr key={o.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#e3dbfd] text-[#514d68]">
                        {o.override_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439] max-w-[300px] truncate">{o.note || "—"}</td>
                    <td className="px-6 py-4 text-xs text-[#566166]">{timeAgo(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <SpeedBranchControls
        branchId={id}
        isReseller={(branch.book_type ?? "reseller") === "reseller"}
        speedRow={(speedRow as Parameters<typeof SpeedBranchControls>[0]["speedRow"]) ?? null}
        recentLedger={(speedLedger as Parameters<typeof SpeedBranchControls>[0]["recentLedger"]) ?? []}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between">
      <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">{label}</span>
      <span className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-4 text-[#2a3439]">{value}</span>
    </div>
  );
}
