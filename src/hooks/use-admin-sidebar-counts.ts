"use client";

// W7 cutover: TanStack Query polling against /api/admin/sidebar-counts.

import { useQuery } from "@tanstack/react-query";
import type { AdminSidebarCounts } from "@/types/database";

export type { AdminSidebarCounts };

const EMPTY: AdminSidebarCounts = {
  pending_deposits: 0,
  pending_withdrawals: 0,
  pending_finance: 0,
};

export function useAdminSidebarCounts(): AdminSidebarCounts {
  const query = useQuery<AdminSidebarCounts>({
    queryKey: ["admin-sidebar-counts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sidebar-counts");
      if (res.status === 401 || res.status === 403) {
        // Caller isn't an admin — return EMPTY rather than throwing so
        // every render of the admin shell doesn't error log.
        return EMPTY;
      }
      if (!res.ok) {
        throw new Error(`Failed to load sidebar counts (${res.status})`);
      }
      return res.json();
    },
    refetchInterval: 10_000,
    staleTime: 9_000,
    refetchOnWindowFocus: true,
  });

  return query.data ?? EMPTY;
}
