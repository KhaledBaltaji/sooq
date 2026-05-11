"use client";

// Mig 0034+0044 follow-up — the client's authoritative source for
// `offered_prob`, `mark_prob`, `cashout_amount`, etc.
//
// Background: the server applies three layers of pricing logic the
// client cannot replicate locally — `_speed_pricing_apply()` (matrix
// asym push-up), `_speed_apply_user_shading()` (CLV throttle), and
// `speed_market_config` per-market reads. Before this hook, the client
// computed offered_prob locally from globals and drifted by up to
// 20pp on extreme-odds trades. Users saw "to win $167" then got a $50
// position. Trust death.
//
// This hook fetches /api/speed/quote (which calls the same server-side
// functions the trade RPC uses at execute time) and surfaces the
// authoritative price. Every display surface — trade panel, mobile
// trade bar, round-v2, position panel — switches its `offered_prob`,
// `mark_prob`, `cashout_amount`, and `soft_blocked` reads to this hook.
// Local computation stays only for the chart line (responsiveness).
//
// /api/speed/quote requires a session — anonymous users get 401 and
// see undefined quote. Trade button is already gated on auth so this
// is harmless.

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { SpeedAsset } from "@/types/database";

// Mirrors the server's TradeQuote shape (src/app/api/speed/quote/route.ts).
export interface SpeedTradeQuote {
  mode: "trade";
  market_id: string;
  side: "over" | "under";
  asset: SpeedAsset;
  spot_price: number;
  strike_price: number;
  seconds_left: number;
  seconds_left_bucket: number;
  iv_used: number;
  fair_prob_side: number;
  mark_prob: number;
  offered_prob: number;
  payout_if_won: number;
  spread_mult: number;
  matrix_used: boolean;
  matrix_version: number | null;
  soft_blocked: boolean;
  near_decided_block: boolean;
  late_window_block: boolean;
  max_stake_allowed: number;
  is_open: boolean;
  next_open_at: string | null;
  rejected: boolean;
  reject_reason: string | null;
  reject_code: string | null;
}

export interface SpeedCashoutQuote {
  mode: "cashout";
  position_id: string;
  market_id: string;
  side: "over" | "under";
  stake: number;
  entry_offered_prob: number;
  spot_price: number;
  strike_price: number;
  seconds_left: number;
  seconds_left_bucket: number;
  iv_used: number;
  mark_prob: number;
  matrix_used: boolean;
  matrix_version: number | null;
  is_winning: boolean;
  fair_profit: number;
  margin_applied: number;
  cashout_amount: number;
  cap_edge: boolean;
  expected_settlement_payout: number;
  near_decided_block: boolean;
  late_window_block: boolean;
  rejected: boolean;
  reject_reason: string | null;
  reject_code: string | null;
}

async function postTradeQuote(
  marketId: string,
  side: "over" | "under",
): Promise<SpeedTradeQuote | null> {
  const res = await fetch("/api/speed/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "trade", market_id: marketId, side }),
  });
  if (res.status === 401) return null; // anon → caller handles
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `Quote failed (${res.status})`,
    );
  }
  return (await res.json()) as SpeedTradeQuote;
}

async function postCashoutQuote(
  positionId: string,
): Promise<SpeedCashoutQuote | null> {
  const res = await fetch("/api/speed/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "cashout", position_id: positionId }),
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `Cashout quote failed (${res.status})`,
    );
  }
  return (await res.json()) as SpeedCashoutQuote;
}

/**
 * Authoritative trade-side quote for a given (market, side).
 * Refetches every 1.5 seconds so the displayed price follows live BTC.
 *
 * Pass `enabled: false` to suppress the fetch (e.g. market closed,
 * user not logged in, side hasn't been picked).
 */
export function useSpeedTradeQuote(
  marketId: string | null | undefined,
  side: "over" | "under" | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  const enabled = (opts.enabled ?? true) && !!marketId && !!side;
  const query = useQuery<SpeedTradeQuote | null>({
    queryKey:
      marketId && side
        ? queryKeys.speedQuote.trade(marketId, side)
        : ["speed-quote", "trade", "noop"],
    queryFn: () => postTradeQuote(marketId!, side!),
    enabled,
    // BTC ticks ~10Hz; 1.5s gives a fresh price ~6x per round of trading.
    refetchInterval: 1500,
    // We never want a stale quote sitting in cache after the user navigates
    // away and back — the price moves.
    staleTime: 0,
    gcTime: 5_000,
    // 401 is expected when anon; don't retry.
    retry: 1,
  });
  return {
    quote: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ? String(query.error) : null,
  };
}

/**
 * Authoritative cashout quote for an open position. Refetches every 1.5s.
 *
 * Pass `enabled: false` after the position closes (won/lost/refunded).
 */
export function useSpeedCashoutQuote(
  positionId: string | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  const enabled = (opts.enabled ?? true) && !!positionId;
  const query = useQuery<SpeedCashoutQuote | null>({
    queryKey: positionId
      ? queryKeys.speedQuote.cashout(positionId)
      : ["speed-quote", "cashout", "noop"],
    queryFn: () => postCashoutQuote(positionId!),
    enabled,
    refetchInterval: 1500,
    staleTime: 0,
    gcTime: 5_000,
    retry: 1,
  });
  return {
    quote: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ? String(query.error) : null,
  };
}
