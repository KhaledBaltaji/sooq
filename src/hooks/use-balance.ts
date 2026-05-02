"use client";

// Balance hook. agent_balance / wagering_requirement / total_wagered were
// stripped in W2/W3 along with the agent + deposit-bonus systems.

import { useUser } from "@/lib/auth/hooks";

export function useBalance() {
  const { user, loading } = useUser();
  return {
    balance: user?.balance_usd ?? 0,
    loading,
  };
}
