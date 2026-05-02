import { notFound } from "next/navigation";
import { fetchBranchByCode, fetchBranchMarkets } from "@/lib/queries/branch-markets";
import { BranchHomeClient } from "@/components/branch/branch-home-client";

export const revalidate = 60;

export default async function BranchHomePage({
  params,
}: {
  params: Promise<{ branch_code: string }>;
}) {
  const { branch_code } = await params;
  const branch = await fetchBranchByCode(branch_code);
  if (!branch) notFound();

  const markets = await fetchBranchMarkets(branch.id);

  return <BranchHomeClient initialMarkets={markets} branchCode={branch.branch_code} />;
}
