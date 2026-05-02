export default function AdminMarketDetailLoading() {
  return (
    <div className="p-8 space-y-8 animate-pulse max-w-[1400px]">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-16 bg-[#e8eff3] rounded" />
        <div className="h-4 w-4 bg-[#e8eff3] rounded" />
        <div className="h-4 w-24 bg-[#e8eff3] rounded" />
        <div className="h-5 w-16 bg-[#e8eff3] rounded ml-3" />
      </div>

      {/* Question title + actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="space-y-3 flex-1">
          <div className="h-10 w-full max-w-xl bg-[#e8eff3] rounded-lg" />
          <div className="h-5 w-80 bg-[#e8eff3] rounded" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-24 bg-[#e8eff3] rounded-lg" />
          <div className="h-10 w-28 bg-[#e8eff3] rounded-lg" />
        </div>
      </div>

      {/* AMM + meta stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3">
            <div className="h-3 w-20 bg-[#e8eff3] rounded" />
            <div className="h-7 w-24 bg-[#e8eff3] rounded" />
            <div className="h-3 w-32 bg-[#f0f4f7] rounded" />
          </div>
        ))}
      </div>

      {/* Two-column: AMM detail + market config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-4">
            <div className="h-5 w-36 bg-[#e8eff3] rounded" />
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="flex justify-between">
                <div className="h-4 w-28 bg-[#e8eff3] rounded" />
                <div className="h-4 w-20 bg-[#e8eff3] rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Recent trades table */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="bg-[#f0f4f7] px-6 py-4 flex gap-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-3 bg-[#d9e4ea] rounded" style={{ width: `${50 + i * 15}px` }} />
          ))}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`px-6 py-5 flex gap-8 ${i % 2 === 0 ? "bg-[#f0f4f7]/20" : ""}`}>
            {[1, 2, 3, 4, 5, 6].map((j) => (
              <div key={j} className="h-4 bg-[#e8eff3] rounded" style={{ width: `${35 + j * 18}px` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
