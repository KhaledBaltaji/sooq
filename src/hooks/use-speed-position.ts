"use client";

// W7 cutover: TanStack Query polling against /api/speed/positions?market_id=…
// Returns the current/most-recent position (if any) for the signed-in user
// on a given speed market. Per locked decision (Round 18), only ONE
// position per (user, market) in v1.

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/hooks";
import type { SpeedPosition } from "@/types/database";

interface ListResponse {
  positions: (SpeedPosition & { market: unknown | null })[];
}

export function useSpeedPosition(marketId: string | null | undefined) {
  const { user } = useSession();

  const query = useQuery<ListResponse>({
    queryKey: ["speed-position", user?.id, marketId],
    queryFn: async () => {
      const res = await fetch(
        `/api/speed/positions?market_id=${encodeURIComponent(marketId!)}&limit=1`
      );
      if (!res.ok) throw new Error(`Failed to load position (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id) && Boolean(marketId),
    refetchInterval: 2_000,
    staleTime: 1_500,
  });

  const positions = query.data?.positions ?? [];
  const position = positions[0] ?? null;

  return { position, loading: query.isLoading };
}
