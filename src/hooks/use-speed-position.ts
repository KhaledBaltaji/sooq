"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { SpeedPosition } from "@/types/database";

/**
 * Returns the current open position (if any) for the signed-in user on a
 * given speed market. Subscribes to INSERT/UPDATE realtime so the trade
 * page flips from "place bet" view to "active position" view immediately
 * after the user places a bet.
 *
 * Per locked decision (Round 18), only ONE position per (user, market) in v1.
 */
export function useSpeedPosition(marketId: string | null | undefined) {
  const supabase = useSupabase();
  const [position, setPosition] = useState<SpeedPosition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      return;
    }
    const mid = marketId;

    let userId: string | null = null;

    async function fetch() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      userId = user.id;

      const { data } = await supabase
        .from("speed_positions" as never)
        .select("*")
        .eq("market_id", mid)
        .eq("user_id", user.id)
        .in("status", ["open", "won", "lost", "cashed_out", "refunded"])
        .order("created_at", { ascending: false })
        .limit(1);
      const rows = data as SpeedPosition[] | null;
      setPosition(rows && rows.length > 0 ? rows[0] : null);
      setLoading(false);
    }
    fetch();

    const channel = supabase
      .channel(`speed_positions-${mid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "speed_positions",
          filter: `market_id=eq.${mid}`,
        },
        (payload) => {
          const next = payload.new as SpeedPosition | null;
          if (!next || !userId || next.user_id !== userId) return;
          setPosition(next);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, marketId]);

  return { position, loading };
}
