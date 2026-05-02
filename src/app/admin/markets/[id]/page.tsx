import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { MarketActions } from "@/components/admin/market-actions";
import { EditMarketButton } from "@/components/admin/edit-market-button";
import { MarketKeywordsEditor } from "@/components/admin/market-keywords-editor";
import type { Market, AmmState } from "@/types/market";
import type { MarketStatus } from "@/types/database";

const STATUS_CONFIG: Record<MarketStatus, { label: string; dotClass: string; textClass: string }> = {
  draft: { label: "DRAFT", dotClass: "bg-[#717c82]", textClass: "text-[#566166]" },
  open: { label: "OPEN", dotClass: "bg-emerald-500 animate-pulse", textClass: "text-emerald-600" },
  closed: { label: "CLOSED", dotClass: "bg-[#717c82]", textClass: "text-[#566166]/60" },
  resolved: { label: "RESOLVED", dotClass: "bg-[var(--yes)]", textClass: "text-[var(--yes)]" },
  voided: { label: "VOIDED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
};

export default async function AdminMarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: market } = await supabase.from("markets").select("*").eq("id", id).single();
  if (!market) notFound();

  const { data: ammState } = await supabase.from("amm_state").select("*").eq("market_id", id).single();

  // Recent trades for this market
  const { data: trades } = await supabase
    .from("trades")
    .select("id, user_id, side, direction, shares, price_per_share, total_cost, created_at")
    .eq("market_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Get user display names for trade rows
  const userIds = [...new Set((trades || []).map((t) => t.user_id))];
  const { data: users } = userIds.length > 0
    ? await supabase.from("users").select("id, display_name, phone").in("id", userIds)
    : { data: [] };

  const userMap = new Map<string, { display_name: string | null; phone: string | null }>();
  for (const u of users || []) {
    userMap.set(u.id, { display_name: u.display_name, phone: u.phone });
  }

  const m = market as Market;
  const amm = ammState as AmmState | null;
  const statusConf = STATUS_CONFIG[m.status] || STATUS_CONFIG.draft;

  const shortId = (uid: string) => `#${uid.slice(0, 6).toUpperCase()}`;
  const initials = (name: string | null) => {
    if (!name) return "??";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  const avgTradeSize = amm && amm.total_trades > 0
    ? formatCurrency(amm.total_volume / amm.total_trades)
    : "—";

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      {/* Breadcrumbs & Question Header */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-[#566166]">
          <Link href="/admin/markets" className="hover:text-[var(--yes)] transition-colors">Markets</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-[#2a3439] font-semibold">ID: {shortId(m.id)}</span>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold ml-3 ${statusConf.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
            {statusConf.label}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2 flex-1">
            <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
              {m.question_en}
            </h2>
            {m.question_ar && (
              <h3 className="text-2xl font-bold text-[#566166]/70 tracking-tight" dir="rtl">
                {m.question_ar}
              </h3>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pb-2">
            {(m.status === "open" || m.status === "closed" || m.status === "draft") && (
              <EditMarketButton
                market={{
                  id: m.id,
                  question_en: m.question_en,
                  description_en: m.description_en,
                  description_ar: m.description_ar,
                  closes_at: m.closes_at,
                  opens_at: m.opens_at,
                  keywords: (m as Market & { keywords?: string[] }).keywords,
                  image_url: m.image_url,
                }}
              />
            )}
            <MarketActions marketId={id} status={m.status as MarketStatus} />
            {(m.status === "open" || m.status === "closed") && (
              <Link
                href={`/admin/markets/${id}/resolve`}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg shadow-lg hover:shadow-xl transition-all active:scale-95 text-sm uppercase tracking-wider"
              >
                <span className="material-symbols-outlined text-sm">task_alt</span>
                Resolve Market
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Key Stats Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {/* Prices */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-4">
          <div className="bg-white p-6 rounded-xl border-b-4 border-[var(--yes)]/20 flex flex-col justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">Current YES Price</span>
            <div className="flex items-baseline gap-2 mt-4">
              <span className="text-5xl font-black font-[family-name:var(--font-manrope)] text-[#2a3439]">
                {amm ? `${Math.round(amm.current_yes_price * 100)}%` : "—"}
              </span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl border-b-4 border-[var(--error)]/20 flex flex-col justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">Current NO Price</span>
            <div className="flex items-baseline gap-2 mt-4">
              <span className="text-5xl font-black font-[family-name:var(--font-manrope)] text-[#2a3439]">
                {amm ? `${Math.round(amm.current_no_price * 100)}%` : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Volume */}
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">Total Volume</span>
          <span className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-4 text-[#2a3439]">
            {amm ? formatCurrency(amm.total_volume) : "—"}
          </span>
          <div className="w-full h-1 bg-[#d9e4ea] rounded-full mt-2 overflow-hidden">
            <div className="bg-[var(--yes)] h-full" style={{ width: amm ? `${Math.min(100, (amm.total_volume / 10000) * 100)}%` : "0%" }} />
          </div>
        </div>

        {/* Trades */}
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">Total Trades</span>
          <span className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-4 text-[#2a3439]">
            {amm ? amm.total_trades.toLocaleString() : "—"}
          </span>
          <p className="text-xs text-[#566166] mt-2 font-medium">Avg. {avgTradeSize} per trade</p>
        </div>

        {/* Unique Traders */}
        <div className="bg-[#f0f4f7] p-6 rounded-xl flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#566166] font-bold">Unique Traders</span>
          <span className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-4 text-[#2a3439]">
            {m.unique_traders.toLocaleString()}
          </span>
          <p className="text-xs text-[#566166] mt-2 font-medium">
            {m.category && <span className="bg-[#dae2fd] text-[#4a5167] text-[10px] font-bold px-2 py-0.5 rounded uppercase">{m.category}</span>}
          </p>
        </div>
      </section>

      {/* AMM Internals & Market Info */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* AMM Internals Dark Card */}
        <div className="lg:col-span-1 bg-[#0b0f10] text-white p-8 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="relative z-10 space-y-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#dae2fd]">settings_input_component</span>
              <h4 className="font-bold tracking-tight uppercase text-xs">AMM Internals</h4>
            </div>

            {amm ? (
              <div className="grid grid-cols-2 gap-y-8 gap-x-4">
                <div>
                  <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Liquidity Param (b)</p>
                  <p className="text-2xl font-mono font-bold text-[#dae2fd]">{amm.liquidity_param.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Seed P&L</p>
                  <p className={`text-2xl font-mono font-bold ${amm.seed_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {amm.seed_pnl >= 0 ? "+" : ""}{formatCurrency(amm.seed_pnl)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">q_yes (Shares)</p>
                  <p className="text-xl font-mono font-medium">{Math.round(amm.q_yes).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">q_no (Shares)</p>
                  <p className="text-xl font-mono font-medium">{Math.round(amm.q_no).toLocaleString()}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Opening Price</p>
                  {(() => {
                    const p = Number(m.opening_price ?? 0.5);
                    if (!p || Math.abs(p - 0.5) < 0.001) {
                      return <p className="text-sm text-slate-400">50/50 (no seed)</p>;
                    }
                    const b = Number(amm.liquidity_param) || 1000;
                    const seedCost = p >= 0.5
                      ? -b * Math.log(2 * (1 - p))
                      : -b * Math.log(2 * p);
                    return (
                      <p className="text-sm">
                        <span className="font-mono font-bold text-[#dae2fd]">{(p * 100).toFixed(0)}%</span>
                        <span className="text-slate-400"> · seed risk </span>
                        <span className="font-mono font-bold text-amber-400">${seedCost.toFixed(0)}</span>
                        <span className="text-slate-500 text-xs"> (operator loses if market resolves opposite)</span>
                      </p>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <span className="material-symbols-outlined text-3xl text-slate-600 mb-2 block">warning</span>
                <p className="text-sm text-slate-400">No AMM initialized</p>
              </div>
            )}
          </div>

          {/* Background decoration */}
          <div className="absolute -right-10 -bottom-10 opacity-5">
            <span className="material-symbols-outlined text-[180px]">query_stats</span>
          </div>
        </div>

        {/* Market Details Card */}
        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-8">
            <span className="material-symbols-outlined text-[#566166]">info</span>
            <h4 className="font-bold tracking-tight text-[#566166]">Market Details</h4>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Market ID</p>
              <p className="text-sm font-mono text-[#2a3439]">{m.id}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Category</p>
              <p className="text-sm font-medium text-[#2a3439]">{m.category || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Opens At</p>
              <p className="text-sm text-[#2a3439]">{new Date(m.opens_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Closes At</p>
              <p className="text-sm text-[#2a3439]">{new Date(m.closes_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Created At</p>
              <p className="text-sm text-[#2a3439]">{new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            </div>
            {m.resolved_at && (
              <div>
                <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Resolved At</p>
                <p className="text-sm text-[#2a3439]">{new Date(m.resolved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              </div>
            )}
            {m.outcome && (
              <div>
                <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Outcome</p>
                <span className={`text-sm font-bold uppercase ${m.outcome === "yes" ? "text-[var(--yes)]" : "text-[var(--error)]"}`}>
                  {m.outcome}
                </span>
              </div>
            )}
            {m.description_en && (
              <div className="col-span-2">
                <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Description</p>
                <p className="text-sm text-[#2a3439] leading-relaxed">{m.description_en}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* News Feed Keywords */}
      <section>
        <MarketKeywordsEditor marketId={m.id} initialKeywords={(m as Market & { keywords?: string[] }).keywords || []} />
      </section>

      {/* Recent Activity Table */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-bold tracking-tight text-lg text-[#2a3439]">Recent Market Activity</h4>
        </div>

        <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f0f4f7]">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Trade ID</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">User</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Action</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Price</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#a9b4b9]/10">
              {(!trades || trades.length === 0) ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">swap_horiz</span>
                    <p className="text-sm font-medium text-[#566166]">No trades yet</p>
                    <p className="text-xs text-[#a9b4b9] mt-1">Trades will appear here once users start trading</p>
                  </td>
                </tr>
              ) : (
                trades.map((t, i) => {
                  const user = userMap.get(t.user_id);
                  const displayName = user?.display_name || user?.phone || "Unknown";
                  const isBuyYes = t.direction === "buy" && t.side === "yes";
                  const isBuyNo = t.direction === "buy" && t.side === "no";
                  const actionLabel = `${t.direction.toUpperCase()} ${t.side.toUpperCase()}`;
                  const actionStyle = (t.direction === "buy" && t.side === "yes") || (t.direction === "sell" && t.side === "no")
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800";

                  return (
                    <tr
                      key={t.id}
                      className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/10" : ""}`}
                    >
                      <td className="px-6 py-4 font-mono text-xs text-[#566166]">{shortId(t.id)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-[#e3dbfd] flex items-center justify-center text-[10px] font-bold text-[#514d68]">
                            {initials(displayName)}
                          </div>
                          <span className="text-sm font-semibold text-[#2a3439]">{displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${actionStyle}`}>
                          {actionLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-[#2a3439]">{formatCurrency(t.total_cost)}</td>
                      <td className="px-6 py-4 text-sm font-medium text-[#566166]">{Math.round(t.price_per_share * 100)}%</td>
                      <td className="px-6 py-4 text-xs text-[#566166]">{timeAgo(t.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
