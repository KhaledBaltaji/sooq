import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { BRANCH_STATUS_CONFIG, SOLVENCY_STATUS_CONFIG } from "@/types/branch";
import type {
  BranchStatus,
  BranchSolvency,
  BranchDashboardStats,
  BranchDashboardStatsCommission,
  BranchDashboardStatsReseller,
} from "@/types/branch";
import { SolvencyCard } from "@/components/solvency-card";
import { BranchConfigEditor } from "@/components/branch/branch-config-editor";
import { ShareKitButton } from "@/components/branch/share-kit-button";
import { SpeedBranchSection } from "@/components/branch/speed-branch-section";

export default async function BranchDashboardPage() {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: statsRaw } = await sb.rpc("branch_dashboard_stats", { p_branch_id: branch.id });
  const stats = statsRaw as BranchDashboardStats | null;

  const statusConf = BRANCH_STATUS_CONFIG[branch.status as BranchStatus] || BRANCH_STATUS_CONFIG.active;
  const bookType = branch.book_type as string | undefined;

  // Commission branches: no pool, no solvency — render the commission variant
  if (bookType === "commission") {
    const commissionStats = stats as BranchDashboardStatsCommission | null;
    return (
      <CommissionDashboard
        branch={branch}
        stats={commissionStats}
        statusConf={statusConf}
      />
    );
  }

  // Reseller (legacy): full pool + solvency dashboard
  const { data: solvencyRaw } = await sb.rpc("branch_solvency_check", { p_branch_id: branch.id });
  const solvency = solvencyRaw as BranchSolvency | null;
  const solvencyConf = solvency
    ? SOLVENCY_STATUS_CONFIG[solvency.status] || SOLVENCY_STATUS_CONFIG.green
    : SOLVENCY_STATUS_CONFIG.green;
  const resellerStats = stats as BranchDashboardStatsReseller | null;

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Dashboard
          </h2>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
            {statusConf.label}
          </div>
        </div>
        <p className="text-[#566166]">
          Code: <span className="font-mono font-bold">{branch.branch_code}</span>
        </p>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <SolvencyCard solvency={solvency} solvencyConf={solvencyConf} />

        <BranchConfigEditor config={{
          branchId: branch.id as string,
          yesMarkup: Number(branch.yes_markup_pct),
          noMarkup: Number(branch.no_markup_pct),
          exitFee: Number(branch.exit_fee_pct),
          displayMode: branch.display_mode as string,
          cashOutEnabled: branch.cash_out_enabled as boolean,
          branchFeeRate: Number(branch.branch_fee_rate),
          createdAt: branch.created_at as string,
        }} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {[
          { label: "Pool Balance", value: formatCurrency(Number(branch.pool_balance)) },
          { label: "Users", value: resellerStats?.user_count?.toString() || "0" },
          { label: "Active Agents", value: resellerStats?.active_agent_count?.toString() || "0" },
          { label: "Total Volume", value: formatCurrency(resellerStats?.total_volume || 0) },
          { label: "Total Revenue", value: formatCurrency(resellerStats?.total_revenue || 0) },
        ].map((card) => (
          <div key={card.label} className="bg-white p-6 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2">{card.label}</p>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{card.value}</p>
          </div>
        ))}
      </section>

      {resellerStats && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#e8eff3] p-6 rounded-xl">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Trades Last 24h</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{resellerStats.trades_last_24h}</h3>
          </div>
          <div className="bg-[#e8eff3] p-6 rounded-xl">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Active Markets</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{resellerStats.active_markets}</h3>
          </div>
          <div className="bg-[#e8eff3] p-6 rounded-xl">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">Total Trades</p>
            <h3 className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">{resellerStats.trade_count}</h3>
          </div>
        </section>
      )}
    </div>
  );
}

// ===========================================================================
// Commission-branch variant
// ===========================================================================

function CommissionDashboard({
  branch,
  stats,
  statusConf,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  branch: Record<string, any>;
  stats: BranchDashboardStatsCommission | null;
  statusConf: { label: string; dotClass: string; textClass: string };
}) {
  const level = stats?.agent_level ?? 1;
  const activated = stats?.agent_activated ?? false;

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <section className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            {branch.name as string}
          </h2>
          <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700">
            Commission Branch
          </span>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold ${statusConf.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dotClass}`} />
            {statusConf.label}
          </div>
        </div>
        <p className="text-[#566166]">
          Your link:{" "}
          <span className="font-mono font-bold text-[#2a3439]">/b/{branch.branch_code}</span>
        </p>
      </section>

      {/* Activation banner */}
      {!activated && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="font-bold text-amber-900 mb-1">
            Commissions are escrowed until you activate
          </h3>
          <p className="text-sm text-amber-800">
            You need {Math.max(0, 5 - (stats?.qualified_referral_count ?? 0))} more qualified referrals to start collecting earnings.
            Until then, every commission you earn is held safely and will be released the moment you activate.
          </p>
        </section>
      )}

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {[
          {
            label: "Your Users",
            value: (stats?.user_count ?? 0).toString(),
            hint: "People signed up through your branch",
          },
          {
            label: "Sub-Agents",
            value: (stats?.active_agent_count ?? 0).toString(),
            hint: "Active agents under you",
          },
          {
            label: "Earnings (Credited)",
            value: formatCurrency(stats?.commission_credited ?? 0),
            hint: "Released to your wallet",
          },
          {
            label: "Earnings (Escrowed)",
            value: formatCurrency(stats?.commission_escrowed ?? 0),
            hint: activated ? "—" : "Pending activation",
          },
        ].map((card) => (
          <div key={card.label} className="bg-white p-6 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2">
              {card.label}
            </p>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
              {card.value}
            </p>
            <p className="text-[11px] text-[#566166] mt-2">{card.hint}</p>
          </div>
        ))}
      </section>

      {/* Tier progress */}
      <section className="bg-white p-6 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">
              Your Tier
            </p>
            <h3 className="text-3xl font-extrabold font-[family-name:var(--font-manrope)]">
              L{level}
            </h3>
            <p className="text-sm text-[#566166] mt-1">
              Network volume: {formatCurrency(stats?.network_volume ?? 0)}
            </p>
          </div>
          <TierProgress level={level} networkVolume={stats?.network_volume ?? 0} />
        </div>
      </section>

      {/* Speed markets section — only renders if branch is speed-enabled */}
      <SpeedBranchSection branchId={branch.id as string} />

      {/* Share CTA — opens ShareKitModal */}
      <section className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-6 flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h3 className="font-bold text-lg">Grow your network</h3>
          <p className="text-sm text-indigo-900 mt-1">
            Copy a pre-written message, grab your QR code, or preview your share card.
          </p>
        </div>
        <ShareKitButton
          branchCode={branch.branch_code as string}
          branchName={branch.name as string}
        />
      </section>
    </div>
  );
}

// Inline tier-progress display. Thresholds: L1=0, L2=10k, L3=50k, L4=200k.
function TierProgress({ level, networkVolume }: { level: number; networkVolume: number }) {
  const thresholds = [0, 10000, 50000, 200000];
  const nextThreshold = level < 4 ? thresholds[level] : null;

  if (nextThreshold === null) {
    return (
      <div className="text-right">
        <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">
          Max Tier
        </p>
        <p className="text-sm text-emerald-700 font-bold">You're at the top tier</p>
      </div>
    );
  }

  const needed = Math.max(0, nextThreshold - networkVolume);
  const progressPct = Math.min(100, (networkVolume / nextThreshold) * 100);

  return (
    <div className="text-right min-w-[240px]">
      <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1">
        To L{level + 1}
      </p>
      <p className="text-sm font-bold">
        {formatCurrency(needed)} <span className="text-[#566166] font-normal">more</span>
      </p>
      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
