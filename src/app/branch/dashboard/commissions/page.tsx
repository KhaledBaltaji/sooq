import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type CommissionRow = {
  id: string;
  market_id: string | null;
  layer: number;
  commission_rate: number;
  commission_amount: number;
  platform_revenue_amount: number;
  status: "escrowed" | "credited" | "voided" | "pending";
  revenue_type: string;
  source_type: "referral_trade" | "referral_resolution" | "branch_commission" | "branch_pl";
  created_at: string;
};

const SOURCE_LABEL: Record<CommissionRow["source_type"], string> = {
  referral_trade: "Trade",
  referral_resolution: "Resolution",
  branch_commission: "Branch",
  branch_pl: "Branch P/L",
};

const STATUS_STYLE: Record<
  CommissionRow["status"],
  { label: string; className: string }
> = {
  credited: { label: "Credited", className: "bg-emerald-100 text-emerald-700" },
  pending: { label: "Pending", className: "bg-blue-100 text-blue-700" },
  escrowed: { label: "Escrowed", className: "bg-amber-100 text-amber-700" },
  voided: { label: "Voided", className: "bg-slate-200 text-slate-500" },
};

export default async function BranchCommissionsPage() {
  const { branch, user } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: rowsRaw } = await sb
    .from("referral_commissions")
    .select(
      "id, market_id, layer, commission_rate, commission_amount, platform_revenue_amount, status, revenue_type, source_type, created_at",
    )
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (rowsRaw ?? []) as CommissionRow[];

  // Resolve market names for the rows that have a market_id
  const marketIds = [...new Set(rows.map((r) => r.market_id).filter((x): x is string => !!x))];
  const { data: markets } =
    marketIds.length > 0
      ? await supabase.from("markets").select("id, question_en").in("id", marketIds)
      : { data: [] };
  const marketMap = new Map<string, string>();
  for (const m of markets || []) {
    marketMap.set(m.id, m.question_en || "Unknown Market");
  }

  // Totals by status
  const totals = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + Number(r.commission_amount || 0);
      return acc;
    },
    {} as Record<CommissionRow["status"], number>,
  );

  const isCommissionBranch = branch.book_type === "commission";

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
            Commissions
          </h2>
          <p className="text-[#566166]">
            {isCommissionBranch
              ? "Your earnings from users signed up through this branch."
              : "Your referral commissions across all activity."}
          </p>
        </div>
        <div className="grid grid-cols-2 md:flex gap-4">
          <StatCard label="Credited" value={totals.credited ?? 0} tone="emerald" />
          <StatCard label="Pending" value={totals.pending ?? 0} tone="blue" />
          <StatCard label="Escrowed" value={totals.escrowed ?? 0} tone="amber" />
          <StatCard label="Voided" value={totals.voided ?? 0} tone="slate" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <Th>Date</Th>
              <Th>Market</Th>
              <Th>Source</Th>
              <Th>Layer</Th>
              <Th>Platform Revenue</Th>
              <Th>Rate</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-12 text-center text-sm text-[#566166]"
                >
                  No commissions yet. Share your branch link to start earning.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const statusConf = STATUS_STYLE[r.status];
                const marketLabel = r.market_id
                  ? marketMap.get(r.market_id) || r.market_id.slice(0, 8)
                  : "—";
                return (
                  <tr key={r.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-[#566166] whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-[#2a3439] max-w-xs truncate">
                      {marketLabel}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">
                      {SOURCE_LABEL[r.source_type] ?? r.source_type}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-[#2a3439]">L{r.layer}</td>
                    <td className="px-6 py-4 text-sm font-mono text-[#566166]">
                      {formatCurrency(Number(r.platform_revenue_amount || 0))}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-[#566166]">
                      {(Number(r.commission_rate || 0) * 100).toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 text-sm font-mono font-bold text-[#2a3439]">
                      {formatCurrency(Number(r.commission_amount || 0))}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusConf.className}`}
                      >
                        {statusConf.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length >= 200 && (
        <p className="mt-4 text-xs text-[#566166]">
          Showing most recent 200 entries.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "blue" | "amber" | "slate";
}) {
  const toneClass = {
    emerald: "text-emerald-400",
    blue: "text-blue-400",
    amber: "text-amber-400",
    slate: "text-slate-400",
  }[tone];
  return (
    <div className="bg-[#0b0f10] text-white px-6 py-4 rounded-xl">
      <p
        className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${toneClass}`}
      >
        {label}
      </p>
      <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">
      {children}
    </th>
  );
}
