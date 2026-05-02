export function isBranchEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BRANCH_ENABLED === "true";
}
