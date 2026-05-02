"use client";

import { useEffect, useState, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import { useDemoMode } from "./use-demo-mode";
import type { Position } from "@/types/market";

export function usePosition(marketId: string) {
  const supabase = useSupabase();
  const { user } = useUser();
  const isDemo = useDemoMode();
  const positionsTable = isDemo ? "demo_positions" : "positions";
  const [yesPosition, setYesPosition] = useState<Position | null>(null);
  const [noPosition, setNoPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPositions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from(positionsTable as never)
      .select("*")
      .eq("user_id", user.id)
      .eq("market_id", marketId);

    if (data) {
      const positions = data as Position[];
      setYesPosition(positions.find((p) => p.side === "yes") ?? null);
      setNoPosition(positions.find((p) => p.side === "no") ?? null);
    }
    setLoading(false);
  }, [supabase, user, marketId, positionsTable]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    fetchPositions();

    // Realtime updates (demo or live table)
    const channel = supabase
      .channel(`${positionsTable}-${marketId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: positionsTable,
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const pos = payload.new as Position;
          if (pos.market_id !== marketId) return;
          if (pos.side === "yes") setYesPosition(pos);
          else setNoPosition(pos);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user, marketId, fetchPositions, positionsTable]);

  return { yesPosition, noPosition, loading, refetch: fetchPositions };
}
