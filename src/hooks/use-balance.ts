"use client";

import { useUser } from "@/lib/auth/hooks";

export function useBalance() {
  const { user, loading } = useUser();
  return {
    balance: user?.balance_usd ?? 0,
    agent_balance: user?.agent_balance_usd ?? 0,
    loading,
    wagering_requirement: user?.wagering_requirement ?? 0,
    total_wagered: user?.total_wagered ?? 0,
  };
}
