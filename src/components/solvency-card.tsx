import { formatCurrency } from "@/lib/utils";
import type { BranchSolvency } from "@/types/branch";

interface SolvencyCardProps {
  solvency: BranchSolvency | null;
  solvencyConf: { label: string; bgColor: string; color: string };
}

export function SolvencyCard({ solvency, solvencyConf }: SolvencyCardProps) {
  return (
    <div className="lg:col-span-1 bg-[#0b0f10] text-white p-8 rounded-2xl shadow-2xl relative overflow-hidden">
      <div className="relative z-10 space-y-8">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[#dae2fd]">monitoring</span>
          <h4 className="font-bold tracking-tight uppercase text-xs">Solvency</h4>
          {solvency && (
            <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold ${solvencyConf.bgColor} ${solvencyConf.color}`}>
              {solvencyConf.label}
            </span>
          )}
        </div>

        {solvency ? (
          <div className="grid grid-cols-2 gap-y-8 gap-x-4">
            <div>
              <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Pool Balance</p>
              <p className="text-xl font-bold text-[#dae2fd] tabular-nums truncate">{formatCurrency(solvency.pool_balance)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Worst Case</p>
              <p className="text-xl font-bold text-[#dae2fd] tabular-nums truncate">{formatCurrency(solvency.worst_case_total)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Utilization</p>
              <p className={`text-xl font-bold tabular-nums ${
                solvency.utilization >= 0.95 ? "text-red-400" : solvency.utilization >= 0.80 ? "text-amber-400" : "text-emerald-400"
              }`}>
                {Math.round(solvency.utilization * 100)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9d9f] uppercase font-bold tracking-tighter mb-1">Available</p>
              <p className="text-lg font-medium tabular-nums truncate">{formatCurrency(solvency.withdrawal_available)}</p>
            </div>
            {solvency.pending_payouts > 0 && (
              <div className="col-span-2">
                <p className="text-[10px] text-red-400 uppercase font-bold tracking-tighter mb-1">Pending Payouts</p>
                <p className="text-xl font-bold text-red-400 tabular-nums">{formatCurrency(solvency.pending_payouts)}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center">
            <span className="material-symbols-outlined text-3xl text-slate-600 mb-2 block">warning</span>
            <p className="text-sm text-slate-400">Solvency check unavailable</p>
          </div>
        )}
      </div>
      <div className="absolute -right-10 -bottom-10 opacity-5">
        <span className="material-symbols-outlined text-[180px]">shield</span>
      </div>
    </div>
  );
}
