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
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  return {
    positions: query.data?.positions ?? [],
    loading: query.isLoading,
  };
}
