import { requireAdmin } from "@/lib/auth/guards";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { manrope, inter } from "@/lib/fonts";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { allowedViews } = await requireAdmin();

  return (
    <div className={`min-h-screen bg-[#f7f9fb] text-[#2a3439] flex ${manrope.variable} ${inter.variable}`}>
      <AdminSidebar allowedViews={allowedViews} />

      {/* Main content area */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Top header bar — icons only, page titles are in each page */}
        <header className="hidden md:flex justify-end items-center w-full px-8 h-14 bg-[#f7f9fb] sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <button className="p-2 text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7] transition-colors rounded-lg">
              <span className="material-symbols-outlined text-xl">notifications</span>
            </button>
            <button className="p-2 text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7] transition-colors rounded-lg">
              <span className="material-symbols-outlined text-xl">settings</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pt-4 md:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}
