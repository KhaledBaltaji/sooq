"use client";

import { useCallback, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "@/components/providers/supabase-provider";
import type {
  SpeedExecuteCashoutResult,
  SpeedExecuteTradeResult,
  SpeedSide,
} from "@/types/database";

/**
 * Wraps the `speed_execute_trade` and `speed_execute_cashout` RPCs with
 * loading/error state. UI components display the result; idempotency keys
 * prevent double-submits if the user double-taps a button.
 */
export function useSpeedExecuteTrade() {
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBet = useCallback(
    async (marketId: string, side: SpeedSide, stake: number) => {
      setLoading(true);
      setError(null);
      // Stable per-intent key: (market, side, stake) within a 5-second bucket
      // collapse to the same key, so a network-retry of the same bet is
      // deduplicated by the server. Different inputs or a 5s+ delay get a
      // fresh key. (Was: timestamp+random regenerated every call → retries
      // produced duplicate positions.)
      const bucket = Math.floor(Date.now() / 5000);
      const idempotencyKey = `speed-bet-${marketId}-${side}-${stake}-${bucket}`;
      const { data, error: err } = await supabase.rpc(
        "speed_execute_trade" as never,
        {
          p_market_id: marketId,
          p_side: side,
          p_stake: stake,
          p_idempotency_key: idempotencyKey,
        } as never,
      );
      if (err) {
        Sentry.captureMessage("Speed trade failed", {
          level: "error",
          extra: { marketId, side, stake, errorMessage: err.message, errorCode: err.code },
          tags: { source: "hook/speed-execute-trade" },
        });
        setError(err.message);
        setLoading(false);
        return { data: null, error: err.message };
      }
      setLoading(false);
      return { data: data as unknown as SpeedExecuteTradeResult, error: null };
    },
    [supabase],
  );

  return { placeBet, loading, error };
}

export function useSpeedCashout() {
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashout = useCallback(
    async (positionId: string) => {
      setLoading(true);
      setError(null);
      // Stable key per (positionId, 5s-bucket) — see placeBet rationale above.
      const bucket = Math.floor(Date.now() / 5000);
      const idempotencyKey = `speed-cashout-${positionId}-${bucket}`;
      const { data, error: err } = await supabase.rpc(
        "speed_execute_cashout" as never,
        {
          p_position_id: positionId,
          p_idempotency_key: idempotencyKey,
        } as never,
      );
      if (err) {
        Sentry.captureMessage("Speed cashout failed", {
          level: "error",
          extra: { positionId, errorMessage: err.message, errorCode: err.code },
          tags: { source: "hook/speed-cashout" },
        });
        setError(err.message);
        setLoading(false);
        return { data: null, error: err.message };
      }
      setLoading(false);
      return { data: data as unknown as SpeedExecuteCashoutResult, error: null };
    },
    [supabase],
  );

  return { cashout, loading, error };
}
