"use client";

// W7 cutover: Drizzle/RDS-backed via /api/transactions, polled every 5s.
// Replaces the prior supabase.from("transactions") + realtime subscription.

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/hooks";
import type { Transaction } from "@/types/transaction";

interface ListResponse {
  transactions: Transaction[];
}

export function useTransactions(limit = 50) {
  const { user } = useSession();

  const query = useQuery<ListResponse>({
    queryKey: ["transactions", user?.id, limit],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?limit=${limit}`);
      if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  return {
    transactions: query.data?.transactions ?? [],
    loading: query.isLoading,
  };
}
