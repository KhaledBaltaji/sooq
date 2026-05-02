"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { AdminSidebarCounts } from "@/types/database";

export type { AdminSidebarCounts };

const EMPTY: AdminSidebarCounts = {
  pending_deposits: 0,
  pending_withdrawals: 0,
  pending_finance: 0,
};

/**
 * Fetch + live-update pending counts for the admin sidebar badges.
 *
 * Calls `get_admin_sidebar_counts()` on mount, then debounces a refetch on any
 * INSERT/UPDATE to `deposits` or `withdrawals`. The RPC is a handful of COUNT
 * queries — cheap enough to re-run per burst of events.
 */
export function useAdminSidebarCounts() {
  const supabase = useSupabase();
  const [counts, setCounts] = useState<AdminSidebarCounts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    async function refetch() {
      const { data, error } = await supabase.rpc("get_admin_sidebar_counts");
      if (cancelled) return;
      if (error) {
        // Silent fallback — a 403 just means the current user isn't an admin.
        // Keep the previous counts or the EMPTY default.
        return;
      }
      if (data) setCounts(data as AdminSidebarCounts);
    }

    function scheduleRefetch() {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(refetch, 200);
    }

    refetch();

    const channel = supabase
      .channel("admin-sidebar-counts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "deposits" },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deposits" },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "withdrawals" },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "withdrawals" },
        scheduleRefetch,
      )
      .subscribe();

    // Re-check when user returns to the tab — catches events missed while hidden.
    function onVisibility() {
      if (document.visibilityState === "visible") scheduleRefetch();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (refetchTimer) clearTimeout(refetchTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return counts;
}
