import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export default async function AdminAlertsPage() {
  const supabase = await createClient();

  const { data: ammStates } = await supabase
    .from("amm_state")
    .select("market_id, current_yes_price, current_no_price, total_volume, markets(question_en, status)")
    .eq("markets.status", "open");

  const lopsidedMarkets = (ammStates || []).filter((a: any) => {
    if (!a.markets) return false;
    if (a.total_volume < 50) return false;
    return a.current_yes_price > 0.90 || a.current_yes_price < 0.10;
  });

  const { data: balanceMismatches, error: reconcileError } = await supabase.rpc("reconcile_balances");
  const mismatches = reconcileError ? null : ((balanceMismatches as any[]) || []);

  const { data: agentBalanceMismatches, error: agentReconcileError } = await supabase.rpc("reconcile_agent_balances");
  const agentMismatches = agentReconcileError ? null : ((agentBalanceMismatches as any[]) || []);

  // Count unacknowledged system errors (last 24h)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: systemErrorCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("acknowledged", false)
    .in("severity", ["error", "critical"])
    .gte("created_at", twentyFourHoursAgo);
  const errorCount = systemErrorCount || 0;

  // HTTP error tracking (24h)
  const { count: notFoundCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("source", "http/404")
    .gte("created_at", twentyFourHoursAgo);

  const { count: rateLimitCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("source", "http/429")
    .gte("created_at", twentyFourHoursAgo);

  const { count: clientErrorCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("source", "sentry/client")
    .gte("created_at", twentyFourHoursAgo);

  const { count: serverErrorCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("source", "sentry/server")
    .gte("created_at", twentyFourHoursAgo);

  const http404 = notFoundCount || 0;
  const http429 = rateLimitCount || 0;
  const clientErrors = clientErrorCount || 0;
  const serverErrors = serverErrorCount || 0;

  const reconcileCheckFailed = mismatches === null;
  const agentReconcileCheckFailed = agentMismatches === null;
  const totalAlerts = lopsidedMarkets.length + (mismatches?.length || 0) + (agentMismatches?.length || 0) + errorCount + (reconcileCheckFailed ? 1 : 0) + (agentReconcileCheckFailed ? 1 : 0);

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Risk Alerts
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Platform health monitoring and anomaly detection.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${totalAlerts > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
              <span className={`material-symbols-outlined text-lg ${totalAlerts > 0 ? "text-red-500" : "text-emerald-600"}`}>
                {totalAlerts > 0 ? "warning" : "verified"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Alerts</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${totalAlerts > 0 ? "text-red-500" : "text-emerald-600"}`}>
            {totalAlerts}
          </p>
          <p className="text-xs text-[#566166] mt-1">{totalAlerts === 0 ? "All systems clear" : "Needs attention"}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${lopsidedMarkets.length > 0 ? "bg-[var(--warning)]/10" : "bg-emerald-50"}`}>
              <span className={`material-symbols-outlined text-lg ${lopsidedMarkets.length > 0 ? "text-[var(--warning)]" : "text-emerald-600"}`}>
                {lopsidedMarkets.length > 0 ? "trending_flat" : "check_circle"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Lopsided Markets</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${lopsidedMarkets.length > 0 ? "text-[var(--warning)]" : "text-emerald-600"}`}>
            {lopsidedMarkets.length}
          </p>
          <p className="text-xs text-[#566166] mt-1">YES &gt;90% or &lt;10%</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${reconcileCheckFailed ? "bg-amber-50" : (mismatches?.length || 0) > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
              <span className={`material-symbols-outlined text-lg ${reconcileCheckFailed ? "text-amber-500" : (mismatches?.length || 0) > 0 ? "text-red-500" : "text-emerald-600"}`}>
                {reconcileCheckFailed ? "warning" : (mismatches?.length || 0) > 0 ? "error" : "check_circle"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Balance Mismatches</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${reconcileCheckFailed ? "text-amber-500" : (mismatches?.length || 0) > 0 ? "text-red-500" : "text-emerald-600"}`}>
            {reconcileCheckFailed ? "Check Failed" : mismatches?.length || 0}
          </p>
          <p className="text-xs text-[#566166] mt-1">Balance vs verified ledger</p>
        </div>

        <Link href="/admin/logs" className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${errorCount > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
              <span className={`material-symbols-outlined text-lg ${errorCount > 0 ? "text-red-500" : "text-emerald-600"}`}>
                {errorCount > 0 ? "bug_report" : "check_circle"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">System Errors (24h)</span>
          </div>
          <p className={`text-2xl font-extrabold font-[family-name:var(--font-manrope)] ${errorCount > 0 ? "text-red-500" : "text-emerald-600"}`}>
            {errorCount}
          </p>
          <p className="text-xs text-[#566166] mt-1">Unacknowledged errors → View logs</p>
        </Link>
      </div>

      {/* Lopsided Markets */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">trending_flat</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">
            Lopsided Markets
            <span className="ml-2 text-[#a9b4b9] font-normal">({lopsidedMarkets.length})</span>
          </h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {lopsidedMarkets.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-emerald-400 mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              <p className="text-sm font-medium text-[#2a3439]">All clear</p>
              <p className="text-xs text-[#a9b4b9] mt-1">No lopsided markets detected</p>
            </div>
          ) : (
            <div className="divide-y divide-[#a9b4b9]/10">
              {lopsidedMarkets.map((a: any, i: number) => {
                const yesPct = Math.round(a.current_yes_price * 100);
                return (
                  <Link
                    key={a.market_id}
                    href={`/admin/markets/${a.market_id}`}
                    className={`flex items-center justify-between px-6 py-5 hover:bg-[#f0f4f7]/50 transition-colors ${
                      i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
                    }`}
                    style={{ borderLeft: "4px solid var(--warning)" }}
                  >
                    <span className="text-sm font-semibold text-[#2a3439] truncate max-w-md">
                      {a.markets?.question_en}
                    </span>
                    <div className="flex items-center gap-4 shrink-0 ml-4">
                      <span className="text-xs text-[#566166]">{formatCurrency(a.total_volume)} vol</span>
                      <span className="text-sm font-bold text-[var(--warning)] tabular-nums">
                        YES {yesPct}% / NO {100 - yesPct}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* HTTP & Client Error Tracking */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">lan</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">
            Error Tracking (24h)
          </h3>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "404 Not Found", count: http404, icon: "search_off", color: http404 > 10 ? "red" : http404 > 0 ? "amber" : "emerald" },
            { label: "429 Rate Limited", count: http429, icon: "block", color: http429 > 20 ? "red" : http429 > 0 ? "amber" : "emerald" },
            { label: "Client Errors", count: clientErrors, icon: "devices", color: clientErrors > 5 ? "red" : clientErrors > 0 ? "amber" : "emerald" },
            { label: "Server Errors", count: serverErrors, icon: "dns", color: serverErrors > 5 ? "red" : serverErrors > 0 ? "amber" : "emerald" },
          ].map((item) => {
            const colorMap = {
              red: { bg: "bg-red-50", text: "text-red-500", value: "text-red-500" },
              amber: { bg: "bg-amber-50", text: "text-amber-600", value: "text-amber-600" },
              emerald: { bg: "bg-emerald-50", text: "text-emerald-600", value: "text-emerald-600" },
            };
            const c = colorMap[item.color as keyof typeof colorMap];
            return (
              <div key={item.label} className="bg-white p-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.bg}`}>
                    <span className={`material-symbols-outlined text-sm ${c.text}`}>{item.icon}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">{item.label}</span>
                </div>
                <p className={`text-xl font-extrabold font-[family-name:var(--font-manrope)] ${c.value}`}>
                  {item.count}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Balance Mismatches */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">account_balance</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">
            Balance Mismatches
            <span className="ml-2 text-[#a9b4b9] font-normal">({mismatches?.length ?? "?"})</span>
          </h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {reconcileCheckFailed ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-red-500 mb-3 block">error</span>
              <p className="text-sm font-medium text-red-500">Reconciliation failed</p>
              <p className="text-xs text-[#a9b4b9] mt-1">Could not run balance reconciliation</p>
            </div>
          ) : (mismatches?.length || 0) === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-emerald-400 mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              <p className="text-sm font-medium text-[#2a3439]">All reconciled</p>
              <p className="text-xs text-[#a9b4b9] mt-1">All user balances match the ledger</p>
            </div>
          ) : (
            <div className="divide-y divide-[#a9b4b9]/10">
              {(mismatches || []).map((b: any, i: number) => (
                <Link
                  key={b.user_id}
                  href={`/admin/users/${b.user_id}`}
                  className={`flex items-center justify-between px-6 py-5 hover:bg-[#f0f4f7]/50 transition-colors ${
                    i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
                  }`}
                  style={{ borderLeft: "4px solid var(--error)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-red-500 text-sm">person</span>
                    </div>
                    <span className="text-sm font-mono text-[#2a3439]">{b.user_id.slice(0, 8)}...</span>
                  </div>
                  <span className="text-sm font-bold text-[var(--error)] tabular-nums">
                    Diff: {formatCurrency(Math.abs(b.difference))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Agent Balance Mismatches */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">smart_toy</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">
            Agent Balance Mismatches
            <span className="ml-2 text-[#a9b4b9] font-normal">({agentMismatches?.length ?? "?"})</span>
          </h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {agentReconcileCheckFailed ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-red-500 mb-3 block">error</span>
              <p className="text-sm font-medium text-red-500">Agent reconciliation failed</p>
              <p className="text-xs text-[#a9b4b9] mt-1">Could not run agent balance reconciliation</p>
            </div>
          ) : (agentMismatches?.length || 0) === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-emerald-400 mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              <p className="text-sm font-medium text-[#2a3439]">All reconciled</p>
              <p className="text-xs text-[#a9b4b9] mt-1">All agent balances match the ledger</p>
            </div>
          ) : (
            <div className="divide-y divide-[#a9b4b9]/10">
              {(agentMismatches || []).map((b: any, i: number) => (
                <Link
                  key={b.user_id}
                  href={`/admin/users/${b.user_id}`}
                  className={`flex items-center justify-between px-6 py-5 hover:bg-[#f0f4f7]/50 transition-colors ${
                    i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
                  }`}
                  style={{ borderLeft: "4px solid var(--error)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-red-500 text-sm">smart_toy</span>
                    </div>
                    <span className="text-sm font-mono text-[#2a3439]">{b.user_id.slice(0, 8)}...</span>
                  </div>
                  <span className="text-sm font-bold text-[var(--error)] tabular-nums">
                    Diff: {formatCurrency(Math.abs(b.difference))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
