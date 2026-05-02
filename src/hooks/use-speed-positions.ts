"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { SpeedMarket, SpeedPosition } from "@/types/database";

export interface SpeedPositionWithMarket extends SpeedPosition {
  market: SpeedMarket | null;
}

/**
 * Lists the signed-in user's speed positions, joined with their markets.
 * Subscribes to position INSERTs/UPDATEs so the list flips immediately when
 * a bet is placed or settled.
 *
 * Returns positions sorted by closes_at ascending (most-urgent first), then
 * by created_at descending so newer bets float over older settled ones.
 */
export function useSpeedPositions(opts?: { onlyOpen?: boolean }) {
  const supabase = useSupabase();
  const [positions, setPositions] = useState<SpeedPositionWithMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let userId: string | null = null;
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      userId = user.id;

      let q = supabase
        .from("speed_positions" as never)
        .select("*, market:speed_markets(*)")
        .eq("user_id", user.id);
      if (opts?.onlyOpen) q = q.eq("status", "open");
      const { data } = await q.order("created_at", { ascending: false });
      if (cancelled) return;
      const rows = (data as unknown as SpeedPositionWithMarket[]) ?? [];
      setPositions(rows);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`speed_positions-mine`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "speed_positions" },
        async (payload) => {
          const next = payload.new as SpeedPosition | undefined;
          const old = payload.old as Partial<SpeedPosition> | undefined;
          if (!userId) return;
          if (next && next.user_id !== userId) return;

          if (payload.eventType === "INSERT" && next) {
            // Need to fetch joined market
            const { data: marketRow } = await supabase
              .from("speed_markets" as never)
              .select("*")
              .eq("id", next.market_id)
              .single();
            const newRow: SpeedPositionWithMarket = {
              ...next,
              market: (marketRow as SpeedMarket | null) ?? null,
            };
            setPositions((prev) => [newRow, ...prev]);
          } else if (payload.eventType === "UPDATE" && next) {
            setPositions((prev) =>
              prev.map((p) =>
                p.id === next.id ? { ...p, ...next, market: p.market } : p,
              ),
            );
          } else if (payload.eventType === "DELETE" && old?.id) {
            setPositions((prev) => prev.filter((p) => p.id !== old.id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, opts?.onlyOpen]);

  return { positions, loading };
}
