interface Props {
  icon: string;
  label: string;
  value: string;
  subtext?: string;
  current?: number;
  previous?: number;
  color?: string;
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${
      isUp ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
    }`}>
      <span className="material-symbols-outlined text-xs">
        {isUp ? "trending_up" : "trending_down"}
      </span>
      {isUp ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

export function StatsKPICard({ icon, label, value, subtext, current, previous, color }: Props) {
  return (
    <div className="bg-white p-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[#f0f4f7] rounded-lg flex items-center justify-center">
            <span className={`material-symbols-outlined text-base ${color || "text-[var(--yes)]"}`}>
              {icon}
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">{label}</span>
        </div>
        {current !== undefined && previous !== undefined && (
          <TrendBadge current={current} previous={previous} />
        )}
      </div>
      <p className="text-xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{value}</p>
      {subtext && <p className="text-[11px] text-[#566166] mt-0.5">{subtext}</p>}
    </div>
  );
}

export function StatsKPICardSkeleton() {
  return (
    <div className="bg-white p-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] animate-pulse">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 bg-[#f0f4f7] rounded-lg" />
        <div className="h-3 w-16 bg-[#f0f4f7] rounded" />
      </div>
      <div className="h-6 w-24 bg-[#f0f4f7] rounded" />
      <div className="h-3 w-16 bg-[#f0f4f7] rounded mt-2" />
    </div>
  );
}
