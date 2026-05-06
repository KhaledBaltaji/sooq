"use client";

// W7 cutover: trade + cashout go through /api/speed/{trade,cashout}.
// Server runs the RPC inside runAs() so the GUC user_id is set.
//
// Group D cleanup: optimistic position insert on placeBet success +
// instant balance update on both placeBet and cashout via adjustBalance().
// Replaces the old "invalidate-only" path that took 200–3000ms to surface
// the new state to the UI.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/nextjs";
import { useUserContext } from "@/components/providers/user-provider";
import { useSession } from "@/lib/auth/hooks";
import type {
  SpeedExecuteCashoutResult,
  SpeedExecuteTradeResult,
  SpeedSide,
  SpeedPosition,
  SpeedMarket,
} from "@/types/database";

interface ApiError {
  error?: string;
}

interface SpeedPositionWithMarket extends SpeedPosition {
  market: SpeedMarket | null;
}
interface PositionsListResponse {
  positions: SpeedPositionWithMarket[];
}

/**
 * Mig 0030 quote/execute parity snapshot. The client computes these at
 * quote time and echoes them back at execute time so the server can
 * detect drift (price moved, IV cache flipped, late-window crossed)
 * between the two events. All optional — server treats NULL as skip,
 * which preserves backwards-compat for older clients.
 */
export interface TradeParitySnapshot {
  expectedIv?: number;
  expectedSpot?: number;
  /** 0=60s+, 1=30-60s, 2=10-30s, 3=<10s. */
  expectedSecondsLeftBucket?: 0 | 1 | 2 | 3;
  expectedFairProb?: number;
  expectedOfferedProb?: number;
}

export interface CashoutParitySnapshot {
  expectedIv?: number;
  expectedSpot?: number;
  expectedSecondsLeftBucket?: 0 | 1 | 2 | 3;
  expectedMarkProb?: number;
  expectedCashoutAmount?: number;
}

export function useSpeedExecuteTrade() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { adjustBalance, refetch: refetchUser } = useUserContext();
  const { user } = useSession();

  const placeBet = useCallback(
    async (
      marketId: string,
      side: SpeedSide,
      stake: number,
      parity: TradeParitySnapshot = {},
    ) => {
      setLoading(true);
      setError(null);
      // Stable per-intent key: (market, side, stake) within a 5s bucket
      // collapse to the same key, so a network-retry of the same bet is
      // deduplicated by the server.
      const bucket = Math.floor(Date.now() / 5000);
      const idempotencyKey = `speed-bet-${marketId}-${side}-${stake}-${bucket}`;

      try {
        const res = await fetch("/api/speed/trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market_id: marketId,
            side,
            stake,
            idempotency_key: idempotencyKey,
            // Mig 0030 parity snapshot — all fields optional; server treats
            // missing as skip-check (backwards-compat).
            expected_iv: parity.expectedIv,
            expected_spot: parity.expectedSpot,
            expected_seconds_left_bucket: parity.expectedSecondsLeftBucket,
            expected_fair_prob: parity.expectedFairProb,
            expected_offered_prob: parity.expectedOfferedProb,
          }),
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as ApiError;
          const msg = errBody.error || `Trade failed (${res.status})`;
          Sentry.captureMessage("Speed trade failed", {
            level: "error",
            extra: { marketId, side, stake, status: res.status, errorMessage: msg },
            tags: { source: "hook/speed-execute-trade" },
          });
          setError(msg);
          return { data: null, error: msg };
        }

        const data = (await res.json()) as SpeedExecuteTradeResult;

        // Group D: optimistic balance update — debit the stake immediately so
        // the BAL chip in the header drops within the same render frame as the
        // tap-fire animation. The next /api/users/me refetch will reconcile to
        // the authoritative server value.
        adjustBalance(-stake);
        // Background reconciliation: hit /api/users/me so the optimistic
        // estimate gets replaced with the authoritative balance within ~50ms.
        // Doesn't block the optimistic UI.
        void refetchUser();

        // Group D: optimistic position insert. The trade RPC returns
        // `position_id` (and other fields); splice a synthetic position into
        // the cache so the cashout button card animates in immediately,
        // BEFORE the 200ms invalidation refetch lands. Once the refetch
        // returns the authoritative row, TanStack Query's structural sharing
        // dedupes by id.
        if (data?.position_id && data.offered_prob > 0 && data.spot_price > 0) {
          const optimistic: SpeedPositionWithMarket = {
            id: data.position_id,
            user_id: user?.id ?? "",
            market_id: marketId,
            side,
            stake,
            entry_price: data.spot_price,
            entry_offered_prob: data.offered_prob,
            entry_fair_prob: data.fair_prob,
            status: "open",
            payout_amount: null,
            created_at: new Date().toISOString(),
            closed_at: null,
            market: null,
          };
          queryClient.setQueriesData<PositionsListResponse>(
            { queryKey: ["speed-positions"] },
            (prev) => {
              if (!prev) return { positions: [optimistic] };
              if (prev.positions.some((p) => p.id === data.position_id)) return prev;
              return { positions: [optimistic, ...prev.positions] };
            },
          );
        }

        // Reconcile with server (replaces optimistic with authoritative).
        queryClient.invalidateQueries({ queryKey: ["speed-positions"] });
        return { data, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        Sentry.captureMessage("Speed trade threw", {
          level: "error",
          extra: { marketId, side, stake, errorMessage: msg },
          tags: { source: "hook/speed-execute-trade" },
        });
        setError(msg);
        return { data: null, error: msg };
      } finally {
        setLoading(false);
      }
    },
    [queryClient, adjustBalance, refetchUser, user?.id]
  );

  return { placeBet, loading, error };
}

export function useSpeedCashout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { adjustBalance, refetch: refetchUser } = useUserContext();

  const cashout = useCallback(
    async (positionId: string, parity: CashoutParitySnapshot = {}) => {
      setLoading(true);
      setError(null);
      const bucket = Math.floor(Date.now() / 5000);
      const idempotencyKey = `speed-cashout-${positionId}-${bucket}`;

      try {
        const res = await fetch("/api/speed/cashout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position_id: positionId,
            idempotency_key: idempotencyKey,
            // Mig 0030 parity snapshot — all fields optional.
            expected_iv: parity.expectedIv,
            expected_spot: parity.expectedSpot,
            expected_seconds_left_bucket: parity.expectedSecondsLeftBucket,
            expected_mark_prob: parity.expectedMarkProb,
            expected_cashout_amount: parity.expectedCashoutAmount,
          }),
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as ApiError;
          const msg = errBody.error || `Cashout failed (${res.status})`;
          Sentry.captureMessage("Speed cashout failed", {
            level: "error",
            extra: { positionId, status: res.status, errorMessage: msg },
            tags: { source: "hook/speed-cashout" },
          });
          setError(msg);
          return { data: null, error: msg };
        }

        const data = (await res.json()) as SpeedExecuteCashoutResult;

        // Group D: optimistic balance bump using the cashout amount returned
        // by the RPC. User sees BAL chip rise within the same frame as the
        // P&L pop animation. /api/users/me reconciles to the authoritative
        // value within ~50ms.
        const cashoutAmt = Number(data?.cashout_amount ?? 0);
        if (Number.isFinite(cashoutAmt) && cashoutAmt > 0) {
          adjustBalance(cashoutAmt);
        }
        void refetchUser();

        // Optimistic position update: flip the cashed-out row to status
        // 'cashed_out' immediately so the card exits via AnimatePresence
        // before the 5s poll cycle.
        queryClient.setQueriesData<PositionsListResponse>(
          { queryKey: ["speed-positions"] },
          (prev) => {
            if (!prev) return prev;
            return {
              positions: prev.positions.map((p) =>
                p.id === positionId
                  ? {
                      ...p,
                      status: "cashed_out" as SpeedPosition["status"],
                      payout_amount: cashoutAmt,
                      closed_at: new Date().toISOString(),
                    }
                  : p,
              ),
            };
          },
        );
        // Reconcile.
        queryClient.invalidateQueries({ queryKey: ["speed-positions"] });
        return { data, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        Sentry.captureMessage("Speed cashout threw", {
          level: "error",
          extra: { positionId, errorMessage: msg },
          tags: { source: "hook/speed-cashout" },
        });
        setError(msg);
        return { data: null, error: msg };
      } finally {
        setLoading(false);
      }
    },
    [queryClient, adjustBalance, refetchUser]
  );

  return { cashout, loading, error };
}
