"use client";

// W7 cutover: TanStack Query polling against /api/speed/oracle?asset=…
// 2s cadence (replaces the prior realtime + 2s polling fallback). Server
// trade RPC has its own 2s staleness rejection; UI tolerates up to 8s
// before showing the staleness overlay.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SpeedAsset, SpeedOracleLatest } from "@/types/database";

interface ListResponse {
  oracle: SpeedOracleLatest[];
}

export function useSpeedOracleLatest(asset: SpeedAsset = "BTC") {
  const [now, setNow] = useState<number>(Date.now());

  // 1Hz tick drives countdown + staleness UI even if oracle pauses.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const query = useQuery<ListResponse>({
    queryKey: ["speed-oracle", asset],
    queryFn: async () => {
      const res = await fetch(`/api/speed/oracle?asset=${encodeURIComponent(asset)}`);
      if (!res.ok) throw new Error(`Failed to load oracle (${res.status})`);
      return res.json();
    },
    refetchInterval: 2_000,
    staleTime: 1_500,
    refetchOnWindowFocus: true,
  });

  const oracle = (query.data?.oracle ?? []).find((o) => o.asset === asset) ?? null;

  const price = oracle ? Number(oracle.price) : null;
  const receivedAt = oracle ? new Date(oracle.received_at).getTime() : null;
  const staleSeconds = receivedAt ? (now - receivedAt) / 1000 : null;
  // 8s threshold catches outages while tolerating normal poll jitter.
  // Authoritative cut-off (2s) lives server-side in speed_execute_trade.
  const isStale = staleSeconds === null || staleSeconds > 8;

  return { oracle, price, staleSeconds, isStale, loading: query.isLoading };
}
