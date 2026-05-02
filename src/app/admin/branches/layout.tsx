import { notFound } from "next/navigation";
import { isBranchEnabled } from "@/lib/branch-feature-flag";

export default function AdminBranchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isBranchEnabled()) notFound();
  return <>{children}</>;
}
