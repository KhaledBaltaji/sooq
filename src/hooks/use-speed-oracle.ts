"use client";

// Group B: drive primarily off Binance WebSocket for sub-second tick
// granularity. Falls back to TanStack Query polling against
// `/api/speed/oracle` (2s cadence) if the WS connection never receives
// data within 4 seconds — e.g., Lebanese ISP block on stream.binance.com.
//
// Trade execution + settlement still read the server-side
// `speed_oracle_latest` row, which the EC2 oracle worker keeps fresh from
// the same Binance feed at ~10 Hz. This hook is purely for what users see.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SpeedAsset, SpeedOracleLatest } from "@/types/database";
import { useBinanceTicker } from "@/hooks/use-binance-ticker";

interface ListResponse {
  oracle: SpeedOracleLatest[];
}

const ASSET_TO_BINANCE_SYMBOL: Record<SpeedAsset, string> = {
  BTC: "BTCUSDT",
};

/**
 * Latest spot price for a speed asset. Sub-second updates via Binance
 * WS; polling fallback if WS fails. Drop-in compatible with the prior
 * polling-only implementation (same return shape).
 */
export function useSpeedOracleLatest(asset: SpeedAsset = "BTC") {
  const [now, setNow] = useState<number>(Date.now());

  // 1Hz tick drives countdown + staleness UI even if oracle pauses.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Primary: Binance WS direct.
  const ws = useBinanceTicker(ASSET_TO_BINANCE_SYMBOL[asset] ?? "BTCUSDT");

  // Fallback: poll our own oracle endpoint. Only used when WS hasn't
  // produced a tick after a few seconds. The query stays cheap because
  // refetchInterval defaults to 2s and the route is a single PK lookup.
  const fallback = useQuery<ListResponse>({
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

  const fallbackOracle =
    (fallback.data?.oracle ?? []).find((o) => o.asset === asset) ?? null;

  // WS path is the source of truth when it's producing data. We synthesize
  // a SpeedOracleLatest-shaped object for compatibility with consumers
  // that read `oracle.received_at` etc.
  const wsOracle: SpeedOracleLatest | null = ws.observedAt
    ? {
        asset,
        price: ws.price ?? 0,
        received_at: new Date(ws.observedAt).toISOString(),
      }
    : null;

  // Pick the freshest source: WS if it has emitted ANY tick, else polling.
  // (Even a stale WS tick is generally fresher than a 2s-poll oracle row,
  //  but we hedge for the case where WS connected then died.)
  const wsAge = ws.observedAt ? now - ws.observedAt : Infinity;
  const useFallback = !ws.isLive || wsAge > 4_000;
  const oracle = useFallback ? fallbackOracle : wsOracle;

  const price = oracle ? Number(oracle.price) : null;
  const receivedAt = oracle ? new Date(oracle.received_at).getTime() : null;
  const staleSeconds = receivedAt ? (now - receivedAt) / 1000 : null;
  // 8s threshold catches outages while tolerating normal poll jitter.
  // Authoritative cut-off (2s) lives server-side in speed_execute_trade.
  const isStale = staleSeconds === null || staleSeconds > 8;

  return {
    oracle,
    price,
    staleSeconds,
    isStale,
    loading: !ws.isLive && fallback.isLoading,
  };
}
