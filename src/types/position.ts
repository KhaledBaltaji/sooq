/**
 * Unified position type — discriminated union of prediction and speed.
 *
 * Used by `useMergedPositions` and `/trade/page.tsx` to render both kinds
 * of positions in the same list with the same filters and sort chips.
 *
 * Each card component (PositionCard for prediction, SpeedPositionRow for
 * speed) consumes its specific kind. The switch on `kind` in /trade picks
 * which to render per row.
 */

import type { PositionWithMarket } from "@/types/market";
import type { SpeedPositionWithMarket } from "@/hooks/use-speed-positions";

export type UnifiedPosition =
  | { kind: "prediction"; position: PositionWithMarket; pnl: number; createdAt: string }
  | { kind: "speed"; position: SpeedPositionWithMarket; pnl: number; createdAt: string };

export interface UnifiedPositionStats {
  unrealizedPnl: number;
  realizedPnl: number;
  openCostBasis: number;
  openMarketValue: number;
}
