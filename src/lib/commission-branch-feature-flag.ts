/**
 * Commission branch feature flag.
 *
 * Independent from NEXT_PUBLIC_BRANCH_ENABLED so commission branches can be
 * rolled out separately from reseller branches. Admin create form hides the
 * "Commission" book_type option when this is off.
 *
 * Set NEXT_PUBLIC_COMMISSION_BRANCH_ENABLED="true" in Vercel env to enable.
 */
export function isCommissionBranchEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMMISSION_BRANCH_ENABLED === "true";
}
