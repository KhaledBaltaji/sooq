"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";
import type { Market, AmmState } from "@/types/market";

export function useMarket(id: string) {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const marketsTable = isDemo ? "demo_markets" : "markets";
  const ammTable = isDemo ? "demo_amm_state" : "amm_state";
  const [market, setMarket] = useState<Market | null>(null);
  const [ammState, setAmmState] = useState<AmmState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      // Fetch market and AMM state in parallel. Tables swap based on /demo/* route.
      const [marketRes, ammRes] = await Promise.all([
        supabase.from(marketsTable as never).select("*").eq("id", id).single(),
        supabase.from(ammTable as never).select("*").eq("market_id", id).single(),
      ]);

      if (marketRes.error) {
        setError(marketRes.error.message);
      } else {
        setMarket(marketRes.data as Market | null);
      }
      if (!ammRes.error) {
        setAmmState(ammRes.data as AmmState | null);
      }
      setLoading(false);
    }

    fetch();

    // Subscribe to both market and AMM state changes (demo or live tables).
    const channel = supabase
      .channel(`${marketsTable}-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: marketsTable, filter: `id=eq.${id}` },
        (payload) => setMarket(payload.new as Market)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: ammTable, filter: `market_id=eq.${id}` },
        (payload) => setAmmState(payload.new as AmmState)
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error(`Market realtime subscription error for ${isDemo ? "demo " : ""}${id}`);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [supabase, id, marketsTable, ammTable, isDemo]);

  return { market, ammState, loading, error };
}
