import { notFound } from "next/navigation";
import { requireBranchManager } from "@/lib/auth/guards";
import { BranchSidebar } from "@/components/branch/branch-sidebar";
import { isBranchEnabled } from "@/lib/branch-feature-flag";
import { isCommissionBranchEnabled } from "@/lib/commission-branch-feature-flag";
import { manrope, inter } from "@/lib/fonts";
import type { BranchStatus, BranchBookType } from "@/types/branch";

export default async function BranchLayout({ children }: { children: React.ReactNode }) {
  const { branch } = await requireBranchManager();
  const bookType = branch.book_type as BranchBookType | undefined;

  // Commission branches gated separately from reseller/bookmaker branches.
  // If this is a reseller (or undefined legacy) branch, require BRANCH_ENABLED.
  // If this is a commission branch, require COMMISSION_BRANCH_ENABLED.
  if (bookType === "commission") {
    if (!isCommissionBranchEnabled()) notFound();
  } else {
    if (!isBranchEnabled()) notFound();
  }

  return (
    <div className={`min-h-screen bg-[#f7f9fb] text-[#2a3439] flex ${manrope.variable} ${inter.variable}`}>
      <BranchSidebar
        branchName={branch.name as string}
        branchStatus={branch.status as BranchStatus}
        bookType={bookType}
      />

      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        <header className="hidden md:flex justify-end items-center w-full px-8 h-14 bg-[#f7f9fb] sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <button className="p-2 text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7] transition-colors rounded-lg">
              <span className="material-symbols-outlined text-xl">notifications</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto pt-4 md:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}
