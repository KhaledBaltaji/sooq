"use client";

// W7 cutover: TanStack Query polling against /api/speed/positions.
// Returns positions joined with their markets (one query, server-side join).

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/hooks";
import type { SpeedMarket, SpeedPosition } from "@/types/database";

export interface SpeedPositionWithMarket extends SpeedPosition {
  market: SpeedMarket | null;
}

interface ListResponse {
  positions: SpeedPositionWithMarket[];
}

export function useSpeedPositions(opts?: { onlyOpen?: boolean }) {
  const { user } = useSession();

  const query = useQuery<ListResponse>({
    queryKey: ["speed-positions", user?.id, opts?.onlyOpen ?? false],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.onlyOpen) params.set("status", "open");
      const res = await fetch(`/api/speed/positions?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load positions (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id),
    // T3.5: cron settles markets sub-minute; keep 5s polling but rely on
    // optimistic updates in use-speed-trade for sub-second UX. The 2s window
    // here is the worst-case stale-state window after server settles a
    // position open → won/lost. Optimistic mutation cache patches handle
    // the user-driven cashout case immediately.
    refetchInterval: 5_000,
    staleTime: 4_000,
    // T3.7: refetch when user comes back to the tab. Without this, the cache
    // was stuck on whatever state existed at backgrounding time, leading to
    // "Position is not open" rejects when user tapped Cashout on an already-
    // settled position.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    positions: query.data?.positions ?? [],
    loading: query.isLoading,
  };
}
