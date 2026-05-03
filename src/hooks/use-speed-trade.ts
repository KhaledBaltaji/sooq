"use client";

// W7 cutover: trade + cashout go through /api/speed/{trade,cashout}.
// Server runs the RPC inside runAs() so the GUC user_id is set.

import { useCallback, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import type {
  SpeedExecuteCashoutResult,
  SpeedExecuteTradeResult,
  SpeedSide,
} from "@/types/database";

interface ApiError {
  error?: string;
}

export function useSpeedExecuteTrade() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBet = useCallback(
    async (
      marketId: string,
      side: SpeedSide,
      stake: number,
      expectedIv?: number,
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
            expected_iv: expectedIv,
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
    []
  );

  return { placeBet, loading, error };
}

export function useSpeedCashout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashout = useCallback(async (positionId: string, expectedIv?: number) => {
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
          expected_iv: expectedIv,
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
  }, []);

  return { cashout, loading, error };
}
