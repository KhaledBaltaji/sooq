"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { SpeedAsset } from "@/types/database";

/**
 * Returns the last 24 hours of BTC spot price as a sparkline-friendly array
 * of numbers. Used by SpeedHeroCard.
 *
 * Plain useState + useEffect, refreshes every 30 min. Previously used
 * React Query but the cache + staleTime semantics interacted badly with
 * Next.js SSR hydration — an empty cache from server render was treated
 * as "fresh data", suppressing the client-side fetch and leaving the
 * sparkline blank forever. The simpler pattern fetches every mount,
 * polls on a 30-min interval, and always recovers from transient errors.
 *
 * Backed by mig 333's get_speed_price_history RPC (AVG-bucketed, ≤60
 * points for 24h window).
 */
export function useSpeed24hSparkline(asset: SpeedAsset = "BTC") {
  const supabase = useSupabase();
  const [points, setPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const { data, error } = await supabase.rpc(
        "get_speed_price_history" as never,
        {
          p_asset: asset,
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_max_points: 60,
        } as never,
      );
      if (cancelled) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("useSpeed24hSparkline fetch error", error);
        setLoading(false);
        return;
      }
      const rows = (data as { ts: string; price: number | string }[] | null) ?? [];
      setPoints(rows.map((r) => Number(r.price)));
      setLoading(false);
    }
    fetch();
    const id = window.setInterval(fetch, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [supabase, asset]);

  return { points, loading };
}
