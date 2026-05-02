"use client";

import { useEffect, useState, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";

export interface BranchAgentInfo {
  id: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  agent_type: "pl" | "commission" | null;
  rate: number | null;
  deposit_required: number;
  rejection_reason: string | null;
  referral_code: string | null;
  cumulative_pl: number;
  created_at: string;
}

export function useBranchAgentStatus(branchId: string | undefined) {
  const supabase = useSupabase();
  const { user: authUser } = useSession();
  const [agent, setAgent] = useState<BranchAgentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!authUser || !branchId) { setLoading(false); return; }
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("branch_agents")
      .select("id, status, agent_type, rate, deposit_required, rejection_reason, referral_code, cumulative_pl, created_at")
      .eq("user_id", authUser.id)
      .eq("branch_id", branchId)
      .maybeSingle();
    setAgent(data ?? null);
    setLoading(false);
  }, [supabase, authUser, branchId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { agent, loading, refetch };
}
