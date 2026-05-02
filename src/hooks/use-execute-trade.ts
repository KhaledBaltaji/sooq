"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";
import type { Side, TradeDirection } from "@/types/database";
import type { ExecuteTradeResult } from "@/types/market";

export function useExecuteTrade() {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteTradeResult | null>(null);

  const executeTrade = async (
    marketId: string,
    side: Side,
    direction: TradeDirection,
    amount: number
  ) => {
    setLoading(true);
    setError(null);
    setResult(null);

    const rpcArgs = direction === "sell"
      ? { p_market_id: marketId, p_side: side, p_shares_to_sell: amount }
      : { p_market_id: marketId, p_side: side, p_amount: amount };

    // Route to demo RPC when user is inside /demo/*. demo_execute_trade
    // operates on demo_* tables with zero fees/commissions/revenue and
    // never writes to live tables.
    const rpcName = isDemo ? "demo_execute_trade" : "execute_trade";
    const { data, error: err } = await supabase.rpc(rpcName as never, rpcArgs as never);

    if (err) {
      Sentry.captureMessage("Trade execution failed", {
        level: "error",
        extra: { marketId, side, direction, amount, demo: isDemo, errorMessage: err.message, errorCode: err.code },
        tags: { source: "hook/execute-trade", demo: String(isDemo) },
      });
      setError(err.message);
      setLoading(false);
      return { data: null, error: err.message };
    }

    const tradeResult = data as unknown as ExecuteTradeResult;
    setResult(tradeResult);
    setLoading(false);
    return { data: tradeResult, error: null };
  };

  const reset = () => {
    setError(null);
    setResult(null);
  };

  return { executeTrade, loading, error, result, reset };
}
