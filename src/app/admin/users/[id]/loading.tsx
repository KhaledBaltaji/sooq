export default function AdminUserDetailLoading() {
  return (
    <div className="p-8 space-y-8 animate-pulse max-w-[1400px]">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-14 bg-[#e8eff3] rounded" />
        <div className="h-4 w-4 bg-[#e8eff3] rounded" />
        <div className="h-4 w-24 bg-[#e8eff3] rounded" />
      </div>

      {/* User header — avatar + name + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#e8eff3] rounded-full" />
          <div className="space-y-2">
            <div className="h-8 w-48 bg-[#e8eff3] rounded-lg" />
            <div className="flex items-center gap-3">
              <div className="h-4 w-32 bg-[#e8eff3] rounded" />
              <div className="h-5 w-14 bg-[#e8eff3] rounded" />
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-24 bg-[#e8eff3] rounded-lg" />
          <div className="h-10 w-28 bg-[#e8eff3] rounded-lg" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3">
            <div className="h-3 w-20 bg-[#e8eff3] rounded" />
            <div className="h-7 w-24 bg-[#e8eff3] rounded" />
            <div className="h-3 w-32 bg-[#f0f4f7] rounded" />
          </div>
        ))}
      </div>

      {/* Referral network + agent info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-4">
            <div className="h-5 w-36 bg-[#e8eff3] rounded" />
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex justify-between">
                <div className="h-4 w-28 bg-[#e8eff3] rounded" />
                <div className="h-4 w-20 bg-[#e8eff3] rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="bg-[#f0f4f7] px-6 py-4 flex gap-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-3 bg-[#d9e4ea] rounded" style={{ width: `${50 + i * 18}px` }} />
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={`px-6 py-5 flex gap-8 ${i % 2 === 0 ? "bg-[#f0f4f7]/20" : ""}`}>
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="h-4 bg-[#e8eff3] rounded" style={{ width: `${40 + j * 20}px` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
