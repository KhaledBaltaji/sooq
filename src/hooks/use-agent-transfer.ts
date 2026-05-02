"use client";

import { useState, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";

export function useAgentTransfer() {
  const supabase = useSupabase();
  const { refetch } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transfer = useCallback(async (amount: number) => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "transfer_agent_to_portfolio",
        { p_amount: amount }
      );
      if (rpcError) {
        setError(rpcError.message);
        return null;
      }
      await refetch();
      return data as unknown as { agent_balance_usd: number; balance_usd: number };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfer failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabase, refetch]);

  return { transfer, loading, error };
}
