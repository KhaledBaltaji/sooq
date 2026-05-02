"use client";

import { useEffect, useState, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import { useDemoMode } from "./use-demo-mode";
import type { PositionWithMarket, AmmState } from "@/types/market";

interface PortfolioStats {
  totalInvested: number;   // lifetime cumulative buy cost (includes positions already sold)
  unrealizedPnl: number;   // Σ (market_value − cost_basis) over OPEN positions
  realizedPnl: number;     // Σ realized_pnl across closed trades
  openCostBasis: number;   // Σ (shares_held × avg_entry_price) over OPEN positions
  openMarketValue: number; // Σ (shares_held × current_price) over OPEN positions
}

const ZERO_STATS: PortfolioStats = {
  totalInvested: 0,
  unrealizedPnl: 0,
  realizedPnl: 0,
  openCostBasis: 0,
  openMarketValue: 0,
};

export function usePositions() {
  const supabase = useSupabase();
  const { user } = useUser();
  const isDemo = useDemoMode();
  const positionsTable = isDemo ? "demo_positions" : "positions";
  const marketsTable = isDemo ? "demo_markets" : "markets";
  const ammTable = isDemo ? "demo_amm_state" : "amm_state";
  const [positions, setPositions] = useState<PositionWithMarket[]>([]);
  const [stats, setStats] = useState<PortfolioStats>(ZERO_STATS);
  const [loading, setLoading] = useState(true);

  const fetchPositions = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Fetch positions with market data (demo or live tables)
      const { data: posData, error: posError } = await supabase
        .from(positionsTable as never)
        .select(`*, market:${marketsTable}(*)`)
        .eq("user_id", user.id)
        .gt("shares_held", 0.001)
        .order("updated_at", { ascending: false });

      if (posError) {
        console.error("Failed to fetch positions:", posError);
        setLoading(false);
        return;
      }

      if (!posData) {
        setLoading(false);
        return;
      }

      // Fetch AMM state for each market
      const marketIds = [...new Set(posData.map((p: any) => p.market_id))];
      const { data: ammData, error: ammError } = await supabase
        .from(ammTable as never)
        .select("*")
        .in("market_id", marketIds);

      if (ammError) {
        console.error("Failed to fetch AMM state:", ammError);
      }

      const ammMap = new Map<string, AmmState>();
      if (ammData) {
        for (const amm of ammData as AmmState[]) {
          ammMap.set(amm.market_id, amm);
        }
      }

      const enriched: PositionWithMarket[] = posData.map((p: any) => ({
        ...p,
        market: p.market,
        amm_state: ammMap.get(p.market_id) ?? null,
      }));

      setPositions(enriched);

      // Calculate aggregate stats. openCostBasis + openMarketValue are what
      // the /trade page's "Total Portfolio" display needs — cash + open
      // market value gives true equity. unrealizedPnl alone is only the
      // change-in-value, missing the $ tied up in open positions.
      let totalInvested = 0;
      let unrealizedPnl = 0;
      let realizedPnl = 0;
      let openCostBasis = 0;
      let openMarketValue = 0;

      for (const pos of enriched) {
        totalInvested += pos.total_invested;
        realizedPnl += pos.realized_pnl;
        if (pos.amm_state && pos.shares_held >= 0.001) {
          const currentPrice = pos.side === "yes"
            ? pos.amm_state.current_yes_price
            : pos.amm_state.current_no_price;
          const currentValue = pos.shares_held * currentPrice;
          const costBasis = pos.shares_held * pos.avg_entry_price;
          unrealizedPnl += currentValue - costBasis;
          openCostBasis += costBasis;
          openMarketValue += currentValue;
        }
      }

      setStats({ totalInvested, unrealizedPnl, realizedPnl, openCostBasis, openMarketValue });
    } catch (err) {
      console.error("Failed to fetch positions:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase, user, positionsTable, marketsTable, ammTable]);

  // Initial fetch
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Realtime subscription: re-fetch when positions or amm_state change (demo or live tables)
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`${positionsTable}-portfolio-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: positionsTable, filter: `user_id=eq.${user.id}` },
        () => fetchPositions()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: ammTable },
        () => fetchPositions()
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error(`${positionsTable} portfolio realtime subscription error`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPositions, supabase, user, positionsTable, ammTable]);

  return { positions, stats, loading, refetch: fetchPositions };
}
