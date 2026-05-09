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
import { useSpeedFeeConfig } from "@/hooks/use-speed-fee-config";

interface ListResponse {
  oracle: SpeedOracleLatest[];
}

const ASSET_TO_BINANCE_SYMBOL: Record<SpeedAsset, string> = {
  BTC: "BTCUSDT",
  GOLD: "PAXGUSDT",
};

/**
 * Latest spot price for a speed asset. Sub-second updates via Binance
 * WS; polling fallback if WS fails. Drop-in compatible with the prior
 * polling-only implementation (same return shape).
 */
export function useSpeedOracleLatest(asset: SpeedAsset = "BTC") {
  const [now, setNow] = useState<number>(Date.now());
  const feeConfig = useSpeedFeeConfig();

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

  // Source-aware staleness calculation. The two paths feed different timestamp
  // sources and need different math:
  //
  //   - WS path: ws.observedAt is `Date.now()` set inside the browser when the
  //     Binance WS message handler fires (see lib/binance/ws-client.ts:206).
  //     Both endpoints of the comparison are device-local clocks, so device
  //     clock skew vs the server doesn't matter. Just (now - observedAt).
  //
  //   - Fallback (polling) path: the server pre-computes `age_ms` at request
  //     time using its own clock. The client adds elapsed time since the
  //     response landed (TanStack's dataUpdatedAt), measured in device-local
  //     wall time. Result: server-clock age + small device-clock delta.
  //     Critically, NEITHER subtracts a server timestamp from a device
  //     timestamp directly, so device clock skew can't trigger false stale.
  //
  // Pre-fix (commit 753eb86 / T3.3) used `Date.now() - received_at` for both
  // paths. `received_at` from the polling endpoint is server-clock, so any
  // device with >3s clock skew read as permanently stale.
  let staleSeconds: number | null;
  if (useFallback) {
    if (
      fallbackOracle &&
      typeof fallbackOracle.age_ms === "number" &&
      fallback.dataUpdatedAt > 0
    ) {
      const elapsedSinceFetchMs = Math.max(0, now - fallback.dataUpdatedAt);
      staleSeconds = (fallbackOracle.age_ms + elapsedSinceFetchMs) / 1000;
    } else {
      staleSeconds = null;
    }
  } else if (ws.observedAt) {
    staleSeconds = (now - ws.observedAt) / 1000;
  } else {
    staleSeconds = null;
  }

  // Threshold: align with server's `speed_oracle_stale_seconds` (default 2s,
  // admin-tunable). 2.5× buffer with a 5s floor absorbs:
  //   - 2s polling cadence (the next poll arrives up to 2s after the last)
  //   - ~500ms transit lag
  //   - momentary WS reconnect blips
  //   - sub-second drift between server clock and device wall-clock during
  //     the elapsed-since-fetch interval
  // Tighter than the pre-T3 hardcoded 8s, so the chart no longer "looks fresh
  // while server rejects" — but loose enough not to flicker on normal jitter.
  const serverStaleS = feeConfig.pricing.oracleStaleSeconds ?? 2;
  const clientStaleThresholdS = Math.max(serverStaleS * 2.5, 5);
  const isStale = staleSeconds === null || staleSeconds > clientStaleThresholdS;

  return {
    oracle,
    price,
    staleSeconds,
    isStale,
    loading: !ws.isLive && fallback.isLoading,
  };
}
