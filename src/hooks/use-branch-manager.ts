"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";

interface ManagedBranch {
  id: string;
  name: string;
  branch_code: string;
  status: string;
}

let cachedResult: ManagedBranch | null | undefined = undefined; // undefined = not yet fetched

export function useBranchManager() {
  const supabase = useSupabase();
  const { user: authUser, loading: sessionLoading } = useSession();
  const [managedBranch, setManagedBranch] = useState<ManagedBranch | null>(cachedResult ?? null);
  const [loading, setLoading] = useState(cachedResult === undefined);

  useEffect(() => {
    if (sessionLoading || !authUser) {
      setLoading(false);
      return;
    }
    if (cachedResult !== undefined) {
      setManagedBranch(cachedResult);
      setLoading(false);
      return;
    }

    (async () => {
      const { data } = await (supabase as any)
        .from("branches")
        .select("id, name, branch_code, status")
        .eq("manager_user_id", authUser.id)
        .limit(1)
        .single();

      const result = data ?? null;
      cachedResult = result;
      setManagedBranch(result);
      setLoading(false);
    })();
  }, [supabase, authUser, sessionLoading]);

  return { managedBranch, loading };
}
