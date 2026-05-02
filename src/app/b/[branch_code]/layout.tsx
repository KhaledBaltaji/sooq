import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isBranchEnabled } from "@/lib/branch-feature-flag";
import { fetchBranchByCode } from "@/lib/queries/branch-markets";
import { BranchProvider } from "@/components/providers/branch-provider";
import { BranchTopNav } from "@/components/branch/branch-top-nav";
import { BranchFooter } from "@/components/branch/branch-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import type { Metadata } from "next";

interface BranchLayoutProps {
  children: React.ReactNode;
  params: Promise<{ branch_code: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ branch_code: string }> }): Promise<Metadata> {
  const { branch_code } = await params;
  const branch = await fetchBranchByCode(branch_code);
  if (!branch) return {};
  return {
    title: `${branch.name} | Prediction Markets`,
    description: `Trade prediction markets on ${branch.name}, powered by SOOQ.`,
  };
}

export default async function BranchLayout({ children, params }: BranchLayoutProps) {
  if (!isBranchEnabled()) notFound();

  const { branch_code } = await params;
  const branch = await fetchBranchByCode(branch_code);
  if (!branch) notFound();

  return (
    <BranchProvider branch={branch}>
      <div className="min-h-screen bg-bg">
        <Suspense>
          <BranchTopNav branchCode={branch.branch_code} />
        </Suspense>
        <main id="main" className="pt-16 max-w-[1240px] mx-auto px-4 lg:px-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
        <BranchFooter branchName={branch.name} />
        <BottomNav />
      </div>
    </BranchProvider>
  );
}
