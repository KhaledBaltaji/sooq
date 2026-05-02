import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type { AmmState, MarketStatus } from "@/types/market";

const STATUS_CONFIG: Record<string, { label: string; dotClass: string; textClass: string }> = {
  open: { label: "OPEN", dotClass: "bg-emerald-500 animate-pulse", textClass: "text-emerald-600" },
  closed: { label: "CLOSED", dotClass: "bg-[#717c82]", textClass: "text-[#566166]/60" },
  resolved: { label: "RESOLVED", dotClass: "bg-[var(--yes)]", textClass: "text-[var(--yes)]" },
  voided: { label: "VOIDED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
  draft: { label: "DRAFT", dotClass: "bg-[#717c82]", textClass: "text-[#566166]" },
};

// Solvency ratio display helpers. GREATEST(0, cash_in) / worst_case_payout
// so that heavy-sell markets (negative cash_in) don't render a misleading
// "negative percentage" — the dollar NET EXPOSURE card tells the truth.
function formatSolvency(row: { cash_in: string; worst_case_payout: string }): string {
  const cash = Math.max(0, Number(row.cash_in));
  const worst = Number(row.worst_case_payout);
  if (worst === 0) return "∞";
  return `${Math.round((cash / worst) * 100)}%`;
}

function solvencyColor(row: { cash_in: string; worst_case_payout: string }): string {
  const cash = Math.max(0, Number(row.cash_in));
  const worst = Number(row.worst_case_payout);
  if (worst === 0) return "text-emerald-600";
  const pct = (cash / worst) * 100;
  if (pct >= 100) return "text-emerald-600";
  if (pct >= 80) return "text-amber-600";
  return "text-red-500";
}

type AmmRiskRow = {
  section: "aggregate" | "per_market";
  market_id: string | null;
  market_name: string | null;
  market_status: string | null;
  liquidity_param: string | null;
  q_yes: string;
  q_no: string;
  imbalance: string;
  cash_in: string;
  worst_case_payout: string;
  net_exposure: string;
  theoretical_max_loss: string | null;
  is_red_flag: boolean;
};

export default async function AmmDashboardPage() {
  const supabase = await createClient();

  const { data: ammStates, error: ammError } = await supabase
    .from("amm_state")
    .select("*, markets(question_en, status, opening_price)")
    .order("total_volume", { ascending: false });

  const { data: revenue, error: revenueError } = await supabase
    .from("platform_revenue")
    .select("*");

  const { data: feeConfigs, error: feeError } = await supabase.from("fee_config").select("fee_type, rate");

  // Forward-looking AMM risk snapshot (migration 278).
  // RPC returns 1 aggregate row + N per-market rows. If the RPC errors (not
  // admin, function missing, etc.) the page still renders the existing
  // backward-looking content — risk fields just stay at "—".
  const { data: riskRows, error: riskError } = await supabase.rpc("get_amm_risk_snapshot");
  const risk = (riskRows || []) as AmmRiskRow[];
  const riskAggregate = risk.find((r) => r.section === "aggregate") || null;
  const riskByMarket = new Map(
    risk.filter((r) => r.section === "per_market" && r.market_id).map((r) => [r.market_id as string, r]),
  );

  const queryErrors = [ammError, revenueError, feeError, riskError].filter(Boolean);
  if (queryErrors.length > 0) {
    console.error("AMM dashboard query errors:", queryErrors.map((e) => e?.message).join(", "));
  }
  const feeMap = Object.fromEntries((feeConfigs || []).map((f: any) => [f.fee_type, Number(f.rate)]));

  const states = (ammStates || []) as unknown as (AmmState & { markets: { question_en: string; status: MarketStatus; opening_price: number | string | null } })[];

  const totalVolume = states.reduce((s, a) => s + a.total_volume, 0);
  const totalTrades = states.reduce((s, a) => s + a.total_trades, 0);
  const totalSeedPnl = states.reduce((s, a) => s + a.seed_pnl, 0);
  const activeMarkets = states.filter((a) => a.markets?.status === "open").length;

  const totalExplicitFee = (revenue || []).reduce((s: number, r: any) => s + (r.explicit_fee_revenue || 0), 0);
  const totalAmmSpread = (revenue || []).reduce((s: number, r: any) => s + (r.amm_spread_revenue || 0), 0);
  const totalResolutionFee = (revenue || []).reduce((s: number, r: any) => s + (r.resolution_fee_revenue || 0), 0);
  const totalClosePositionFee = (revenue || []).reduce((s: number, r: any) => s + (r.cash_out_premium_revenue || 0), 0);
  const totalCommissions = (revenue || []).reduce((s: number, r: any) => s + (r.total_commissions || 0), 0);
  const totalNetRevenue = (revenue || []).reduce((s: number, r: any) => s + (r.net_revenue || 0), 0);

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          AMM Risk Dashboard
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Automated market maker monitoring and revenue analysis.
        </p>
      </div>

      {/* Risk RPC failure banner — so admin knows the dashboard is degraded, not that exposure is $0 */}
      {riskError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-2xl">error_outline</span>
          <div>
            <p className="text-sm font-bold text-amber-800">Risk snapshot unavailable — showing historical data only</p>
            <p className="text-xs text-amber-700 mt-1">
              Forward-looking exposure could not be loaded. The cards and columns below will show backward-looking numbers; risk columns will read &ldquo;—&rdquo;.
            </p>
          </div>
        </div>
      )}

      {/* Undercapitalized banner — only when aggregate net_exposure > 0 */}
      {riskAggregate && Number(riskAggregate.net_exposure) > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-red-600 text-2xl">warning</span>
          <div>
            <p className="text-sm font-bold text-red-800">
              Retail AMM is undercapitalized by {formatCurrency(Number(riskAggregate.net_exposure))} if worst-case outcomes resolve
            </p>
            <p className="text-xs text-red-700 mt-1">
              Aggregate worst-case payout exceeds cash collected. Monitor per-market exposure below.
            </p>
          </div>
        </div>
      )}

      {/* Forward-looking risk snapshot */}
      {riskAggregate && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-[#566166] text-lg">shield</span>
            <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Forward Exposure</h3>
            <span className="text-[10px] text-[#a9b4b9]">retail AMM, open + closed markets</span>
            <span className="text-[10px] text-[#a9b4b9] ml-auto">
              as of {new Date().toISOString().slice(11, 19)} UTC · reload page to refresh
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-[#fde68a]/30 rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#a16207] text-lg">balance</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Worst-Case Payout</span>
              </div>
              <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">
                {formatCurrency(Number(riskAggregate.worst_case_payout))}
              </p>
              <p className="text-[10px] text-[#a9b4b9] mt-1">if every market resolves against us</p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-emerald-600 text-lg">payments</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Cash In</span>
              </div>
              <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">
                {formatCurrency(Number(riskAggregate.cash_in))}
              </p>
              <p className="text-[10px] text-[#a9b4b9] mt-1">net retail buys minus sells</p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${Number(riskAggregate.net_exposure) > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                  <span className={`material-symbols-outlined text-lg ${Number(riskAggregate.net_exposure) > 0 ? "text-red-500" : "text-emerald-600"}`}>
                    {Number(riskAggregate.net_exposure) > 0 ? "trending_down" : "trending_up"}
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Net Exposure</span>
              </div>
              <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${Number(riskAggregate.net_exposure) > 0 ? "text-red-500" : "text-emerald-600"}`}>
                {Number(riskAggregate.net_exposure) > 0 ? "-" : "+"}{formatCurrency(Math.abs(Number(riskAggregate.net_exposure)))}
              </p>
              <p className="text-[10px] text-[#a9b4b9] mt-1">
                {Number(riskAggregate.net_exposure) > 0 ? "AMM could lose" : "AMM profits regardless"}
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#4a5167] text-lg">monitoring</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Solvency</span>
              </div>
              <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${solvencyColor(riskAggregate)}`}>
                {formatSolvency(riskAggregate)}
              </p>
              <p className="text-[10px] text-[#a9b4b9] mt-1">cash ÷ worst-case</p>
            </div>
          </div>
        </section>
      )}

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4a5167] text-lg">bar_chart</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Volume</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{formatCurrency(totalVolume)}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#d5e3fc] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#455367] text-lg">swap_horiz</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Trades</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{totalTrades.toLocaleString()}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${totalSeedPnl >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
              <span className={`material-symbols-outlined text-lg ${totalSeedPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>trending_up</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Seed P&L</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${totalSeedPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {totalSeedPnl >= 0 ? "+" : ""}{formatCurrency(totalSeedPnl)}
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[var(--yes)]/10 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[var(--yes)] text-lg">bolt</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Active Markets</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{activeMarkets}</p>
        </div>
      </div>

      {/* Revenue Breakdown */}
      <div className="bg-[#0b0f10] text-white p-8 rounded-2xl relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-[#dae2fd]">account_balance</span>
            <h3 className="text-sm font-bold uppercase tracking-widest">5-Layer Revenue Breakdown</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { label: `Explicit Fees (${((feeMap["explicit_fee"] || 0.005) * 100).toFixed(1)}%)`, value: totalExplicitFee, icon: "receipt_long" },
              { label: "AMM Spread", value: totalAmmSpread, icon: "swap_horiz" },
              { label: `Resolution Fees (${((feeMap["resolution_fee"] || 0.01) * 100).toFixed(1)}%)`, value: totalResolutionFee, icon: "gavel" },
              { label: `Cash Out Fee (${((feeMap["cash_out_premium"] || 0.005) * 100).toFixed(1)}%)`, value: totalClosePositionFee, icon: "savings" },
              { label: "Commissions Paid", value: -totalCommissions, icon: "group", negative: true },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-slate-400 text-lg">{item.icon}</span>
                  <span className="text-sm text-slate-300">{item.label}</span>
                </div>
                <span className={`text-sm font-bold font-mono tabular-nums ${item.negative ? "text-red-400" : "text-slate-100"}`}>
                  {item.negative ? "-" : ""}{formatCurrency(Math.abs(item.value))}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-between">
            <span className="text-sm font-bold uppercase tracking-wider">Net Revenue</span>
            <span className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-emerald-400 tabular-nums">
              {formatCurrency(totalNetRevenue)}
            </span>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-white/5 rounded-full blur-3xl" />
      </div>

      {/* Per-Market Table */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">monitoring</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Per-Market AMM State</h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f0f4f7] text-left">
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest min-w-[250px]">Market</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Worst-Case</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Cash In</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Net Exposure</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Imbalance</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-center">YES / NO</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">b</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Volume</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Trades</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Seed P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#a9b4b9]/10">
                {states.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-16 text-center">
                      <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">monitoring</span>
                      <p className="text-sm font-medium text-[#566166]">No AMM states found</p>
                      <p className="text-xs text-[#a9b4b9] mt-1">Create markets with AMM to see data here</p>
                    </td>
                  </tr>
                ) : (
                  states.map((amm, i) => {
                    const status = amm.markets?.status || "draft";
                    const statusConf = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
                    const riskRow = riskByMarket.get(amm.market_id);
                    const netExposure = riskRow ? Number(riskRow.net_exposure) : null;
                    const worstCase = riskRow ? Number(riskRow.worst_case_payout) : null;
                    const cashIn = riskRow ? Number(riskRow.cash_in) : null;
                    const imbalance = riskRow ? Number(riskRow.imbalance) : null;
                    // RPC only returns risk for open/closed markets. For resolved/voided
                    // markets we render "n/a" (not "—") to make clear the gap is
                    // intentional, not missing data.
                    const riskNotApplicable = !riskRow && (status === "resolved" || status === "voided");
                    const emptyCell = riskNotApplicable ? "n/a" : "—";

                    return (
                      <tr
                        key={amm.id}
                        className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                      >
                        <td className="px-6 py-5">
                          <Link
                            href={`/admin/markets/${amm.market_id}`}
                            className="text-sm font-semibold text-[#2a3439] hover:text-[var(--yes)] transition-colors truncate block max-w-[300px]"
                          >
                            {amm.markets?.question_en || "—"}
                          </Link>
                          {(() => {
                            const p = Number(amm.markets?.opening_price ?? 0.5);
                            if (!p || Math.abs(p - 0.5) < 0.001) return null;
                            const b = Number(amm.liquidity_param) || 1000;
                            const seedCost = p >= 0.5
                              ? -b * Math.log(2 * (1 - p))
                              : -b * Math.log(2 * p);
                            return (
                              <p className="text-[10px] text-[#a9b4b9] mt-0.5 truncate max-w-[300px]">
                                Opened at {(p * 100).toFixed(0)}% · seed risk ${seedCost.toFixed(0)}
                              </p>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-5">
                          <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
                            {statusConf.label}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-sm text-[#2a3439] tabular-nums">
                          {worstCase !== null ? formatCurrency(worstCase) : emptyCell}
                        </td>
                        <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">
                          {cashIn !== null ? formatCurrency(cashIn) : emptyCell}
                        </td>
                        <td className={`px-6 py-5 text-right text-sm font-bold tabular-nums ${netExposure === null ? "text-[#a9b4b9]" : netExposure > 0 ? "text-red-500" : "text-emerald-600"}`}>
                          {netExposure === null ? emptyCell : `${netExposure > 0 ? "-" : "+"}${formatCurrency(Math.abs(netExposure))}`}
                        </td>
                        <td className="px-6 py-5 text-right text-sm tabular-nums">
                          {imbalance === null ? (
                            <span className="text-[#a9b4b9]">{emptyCell}</span>
                          ) : (
                            <span className={riskRow?.is_red_flag ? "text-red-500 font-bold" : "text-[#566166]"}>
                              {(imbalance * 100).toFixed(0)}%
                              {riskRow?.is_red_flag && <span className="ml-1">🚨</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm font-bold text-[var(--yes)] tabular-nums">{Math.round(amm.current_yes_price * 100)}%</span>
                            <span className="text-[#a9b4b9]">/</span>
                            <span className="text-sm font-bold text-[#566166] tabular-nums">{Math.round(amm.current_no_price * 100)}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums font-mono">{amm.liquidity_param.toLocaleString()}</td>
                        <td className="px-6 py-5 text-right text-sm font-medium text-[#2a3439] tabular-nums">{formatCurrency(amm.total_volume)}</td>
                        <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">{amm.total_trades.toLocaleString()}</td>
                        <td className={`px-6 py-5 text-right text-sm font-bold tabular-nums ${amm.seed_pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {amm.seed_pnl >= 0 ? "+" : ""}{formatCurrency(amm.seed_pnl)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
