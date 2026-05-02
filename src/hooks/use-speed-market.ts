"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { SpeedMarket } from "@/types/database";

/**
 * Subscribes to a single speed market by id. Fetches once, then receives
 * UPDATEs via realtime (status changes, resolved_at, twap fields).
 */
export function useSpeedMarket(id: string | null | undefined) {
  const supabase = useSupabase();
  const [market, setMarket] = useState<SpeedMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    const marketId = id;

    async function fetch() {
      const { data, error } = await supabase
        .from("speed_markets" as never)
        .select("*")
        .eq("id", marketId)
        .single();
      if (error) setError(error.message);
      else setMarket(data as SpeedMarket | null);
      setLoading(false);
    }
    fetch();

    const channel = supabase
      .channel(`speed_markets-${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "speed_markets",
          filter: `id=eq.${marketId}`,
        },
        (payload) => setMarket(payload.new as SpeedMarket),
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error(`speed_markets realtime error for ${marketId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, id]);

  return { market, loading, error };
}
