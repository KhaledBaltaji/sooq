"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
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

/**
 * Fetches bucketed price history for a speed market.
 *
 * Two representations from two RPCs:
 *   - `data`: AVG-per-bucket points (legacy area-chart consumers, mig 333)
 *   - `candles`: OHLC per bucket from `get_speed_klines` (mig 343 — pulls
 *      Binance's pre-built 1-second candles directly, no synthesis)
 *
 * Push F replaced the old `get_speed_price_history_ohlc` (synthesized from
 * raw trade ticks via mig 335) with `get_speed_klines` (reads pre-built
 * Binance klines via mig 343). Sub-minute windows return raw 1s candles;
 * longer windows aggregate them. Same response shape, smoother visuals,
 * matches Binance's own chart byte-for-byte.
 *
 * Live right-edge updates are NOT done here. Chart appends live ticks via
 * `useSpeedOracleLatest`, which subscribes to `speed_oracle_latest` (the
 * worker upserts kline.close into that cache on every closed kline).
 *
 * Range: opens_at - 5min through closes_at + 1min (small padding for context).
 *
 * `targetBucketSeconds` controls candle granularity. 5s by default for 5m
 * markets — wider candles read as a "trading platform" instead of a noisy
 * 1Hz tick stream. The hook computes `p_max_buckets` from the time range so
 * `get_speed_klines`'s server-side `GREATEST(1, total_secs / max_buckets)`
 * lands on the requested bucket size. Settlement still reads the raw 1s
 * tick — chart granularity is purely a display concern.
 */
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
  const supabase = useSupabase();
  const [data, setData] = useState<SpeedPricePoint[]>([]);
  const [candles, setCandles] = useState<SpeedCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 30 minutes of pre-market context (was 5min). Gives a 5m market a
    // 36-minute total visible window (~432 5s candles) instead of 11min;
    // gives a 1h market a 91-minute window which the RPC auto-aggregates
    // to 30s buckets when 5s would exceed maxBuckets. Trading-platform feel
    // instead of a thumbnail.
    const from = new Date(new Date(opensAt).getTime() - 30 * 60 * 1000).toISOString();
    const to = new Date(new Date(closesAt).getTime() + 60 * 1000).toISOString();
    // Compute maxBuckets so the RPC's server-side bucket-size formula
    // (GREATEST(1, total_secs / max_buckets)) lands on targetBucketSeconds.
    // Floor with a min of 10 to match the RPC's own clamp.
    const totalSecs = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
    const maxBuckets = Math.max(10, Math.floor(totalSecs / targetBucketSeconds));

    async function load() {
      const [avgRes, ohlcRes] = await Promise.all([
        supabase.rpc(
          "get_speed_price_history" as never,
          {
            p_asset: asset,
            p_from: from,
            p_to: to,
            p_max_points: maxBuckets,
          } as never,
        ),
        supabase.rpc(
          // Push F: switched from get_speed_price_history_ohlc (mig 335,
          // synthesized OHLC from raw trade ticks) to get_speed_klines
          // (mig 343, reads pre-built Binance 1s candles).
          "get_speed_klines" as never,
          {
            p_asset: asset,
            p_from: from,
            p_to: to,
            p_max_buckets: maxBuckets,
          } as never,
        ),
      ]);
      if (cancelled) return;

      if (avgRes.error) {
        setError(avgRes.error.message);
      } else {
        const points: SpeedPricePoint[] = (
          (avgRes.data as { ts: string; price: number | string }[] | null) ?? []
        ).map((r) => ({ time: new Date(r.ts).getTime(), price: Number(r.price) }));
        setData(points);
      }

      if (ohlcRes.error) {
        setError(ohlcRes.error.message);
      } else {
        const rows = (ohlcRes.data as
          | {
              bucket_time: string;
              o: number | string;
              h: number | string;
              l: number | string;
              c: number | string;
            }[]
          | null) ?? [];
        const cs: SpeedCandle[] = rows.map((r) => ({
          time: new Date(r.bucket_time).getTime(),
          open: Number(r.o),
          high: Number(r.h),
          low: Number(r.l),
          close: Number(r.c),
        }));
        setCandles(cs);
      }

      setLoading(false);
    }
    load();

    const refresh = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [supabase, asset, opensAt, closesAt, targetBucketSeconds]);

  return { data, candles, loading, error };
}
