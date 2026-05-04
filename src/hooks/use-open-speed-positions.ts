"use client";

// Sibling of `use-speed-position`. Returns ALL open positions for the
// signed-in user on a given market, so the desktop right-column can stack
// one cashout card per position underneath the trade panel.

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/hooks";
import type { SpeedPosition } from "@/types/database";

interface ListResponse {
  positions: (SpeedPosition & { market: unknown | null })[];
}

export function useOpenSpeedPositions(marketId: string | null | undefined) {
  const { user } = useSession();

  const query = useQuery<ListResponse>({
    queryKey: ["speed-open-positions", user?.id, marketId],
    queryFn: async () => {
      const res = await fetch(
        `/api/speed/positions?market_id=${encodeURIComponent(marketId!)}&status=open`
      );
      if (!res.ok) throw new Error(`Failed to load positions (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id) && Boolean(marketId),
    refetchInterval: 2_000,
    staleTime: 1_500,
  });

  const positions = query.data?.positions ?? [];

  return { positions, loading: query.isLoading };
}
