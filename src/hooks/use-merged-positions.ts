"use client";

import { useMemo } from "react";
import { usePositions } from "./use-positions";
import { useSpeedPositions } from "./use-speed-positions";
import { useSpeedOracleLatest } from "./use-speed-oracle";
import {
  durationToSeconds,
  speedFairProbOver,
} from "@/lib/speed/pricing";
import type { UnifiedPosition, UnifiedPositionStats } from "@/types/position";

const IV: Record<string, number> = { BTC: 0.6 };

/**
 * Merges open prediction positions + open speed positions into a single
 * `UnifiedPosition[]` so /trade can render them in one list with shared
 * filters and sort chips.
 *
 * Stats merge:
 *   unrealizedPnl    = prediction unrealizedPnl + (speed fairValue - stake)
 *   openMarketValue  = prediction openMarketValue + Σ speed fairValue
 *   openCostBasis    = prediction openCostBasis + Σ speed stake
 *
 * Speed P/L is computed live from the oracle price using the same
 * Black-Scholes math as the trade panel — so /trade's portfolio total
 * stays in sync with what users see on /speed/[id].
 */
export function useMergedPositions(): {
  positions: UnifiedPosition[];
  stats: UnifiedPositionStats;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const pred = usePositions();
  const { positions: speed, loading: speedLoading } = useSpeedPositions({ onlyOpen: true });
  const { price: btcPrice, isStale } = useSpeedOracleLatest("BTC");

  return useMemo(() => {
    // Prediction positions → unified
    const predUnified: UnifiedPosition[] = pred.positions.map((p) => {
      const currentPrice =
        p.side === "yes"
          ? p.amm_state?.current_yes_price ?? 0
          : p.amm_state?.current_no_price ?? 0;
      const pnl = p.shares_held * currentPrice - p.shares_held * p.avg_entry_price;
      return {
        kind: "prediction" as const,
        position: p,
        pnl,
        createdAt: p.created_at,
      };
    });

    // Speed positions → unified (live P/L from oracle)
    let speedFairTotal = 0;
    let speedStakeTotal = 0;
    const speedUnified: UnifiedPosition[] = speed.map((p) => {
      const market = p.market;
      const stake = Number(p.stake);
      const entryProb = Number(p.entry_offered_prob);
      const payoutPerDollar = 1 / entryProb;

      let fairValue = stake; // fallback to stake if oracle stale / market expired
      if (market && btcPrice && !isStale) {
        const closesAtMs = new Date(market.closes_at).getTime();
        const secondsLeft = Math.max(0, Math.floor((closesAtMs - Date.now()) / 1000));
        if (secondsLeft > 0) {
          const fairOver = speedFairProbOver(
            btcPrice,
            Number(market.strike_price),
            secondsLeft,
            IV[market.asset] ?? 0.6,
          );
          const fairForSide = p.side === "over" ? fairOver : 1 - fairOver;
          fairValue = fairForSide * stake * payoutPerDollar;
        }
      }
      const pnl = fairValue - stake;
      speedFairTotal += fairValue;
      speedStakeTotal += stake;

      return {
        kind: "speed" as const,
        position: p,
        pnl,
        createdAt: p.created_at,
      };
    });

    const all = [...predUnified, ...speedUnified].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );

    const stats: UnifiedPositionStats = {
      unrealizedPnl: pred.stats.unrealizedPnl + (speedFairTotal - speedStakeTotal),
      realizedPnl: pred.stats.realizedPnl, // speed wins/cashouts already credit balance directly
      openCostBasis: pred.stats.openCostBasis + speedStakeTotal,
      openMarketValue: pred.stats.openMarketValue + speedFairTotal,
    };

    return {
      positions: all,
      stats,
      loading: pred.loading || speedLoading,
      refetch: pred.refetch,
    };
  }, [pred, speed, btcPrice, isStale, speedLoading]);
}
