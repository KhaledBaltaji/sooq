"use client";

// W7 cutover: chart history pulled from /api/speed/price-history (avg
// points) + /api/speed/klines (synthesized OHLC). Refresh on a 30s
// interval; live right-edge updates come from useSpeedOracleLatest.

import { useQuery } from "@tanstack/react-query";
import type { SpeedAsset } from "@/types/database";

export interface SpeedPricePoint {
  time: number; // unix ms
  price: number;
}

export interface SpeedCandle {
  time: number; // unix ms (lightweight-charts wants seconds — converted at consumer)
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PointsResponse {
  points: Array<{ ts: string; price: number }>;
}

interface CandlesResponse {
  candles: Array<{ ts: string; o: number; h: number; l: number; c: number }>;
}

export function useSpeedPriceHistory(
  asset: SpeedAsset,
  opensAt: string,
  closesAt: string,
  targetBucketSeconds: number = 5,
): {
  data: SpeedPricePoint[];
  candles: SpeedCandle[];
  loading: boolean;
  error: string | null;
} {
  // 30 minutes of pre-market context. Trading-platform feel.
  const from = new Date(new Date(opensAt).getTime() - 30 * 60 * 1000).toISOString();
  const to = new Date(new Date(closesAt).getTime() + 60 * 1000).toISOString();
  const totalSecs = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  const maxBuckets = Math.max(10, Math.floor(totalSecs / targetBucketSeconds));

  const pointsQ = useQuery<PointsResponse>({
    queryKey: ["speed-price-history", asset, from, to, maxBuckets],
    queryFn: async () => {
      const url = `/api/speed/price-history?asset=${encodeURIComponent(asset)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&max_points=${maxBuckets}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load price history (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const candlesQ = useQuery<CandlesResponse>({
    queryKey: ["speed-klines", asset, from, to, maxBuckets],
    queryFn: async () => {
      const url = `/api/speed/klines?asset=${encodeURIComponent(asset)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&max_buckets=${maxBuckets}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load klines (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const data: SpeedPricePoint[] = (pointsQ.data?.points ?? []).map((r) => ({
    time: new Date(r.ts).getTime(),
    price: Number(r.price),
  }));

  const candles: SpeedCandle[] = (candlesQ.data?.candles ?? []).map((r) => ({
    time: new Date(r.ts).getTime(),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
  }));

  return {
    data,
    candles,
    loading: pointsQ.isLoading || candlesQ.isLoading,
    error:
      pointsQ.error instanceof Error
        ? pointsQ.error.message
        : candlesQ.error instanceof Error
          ? candlesQ.error.message
          : null,
  };
}
