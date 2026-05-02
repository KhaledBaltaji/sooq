"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useBranchContext } from "@/components/providers/branch-provider";
import type { Side, TradeDirection } from "@/types/database";
import type { ExecuteTradeResult } from "@/types/market";

export function useBranchTrade() {
  const supabase = useSupabase();
  const branchCtx = useBranchContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteTradeResult | null>(null);

  const executeBranchTrade = async (
    marketId: string,
    side: Side,
    direction: TradeDirection,
    amount: number
  ) => {
    if (!branchCtx) {
      const msg = "useBranchTrade requires BranchProvider";
      setError(msg);
      return { data: null, error: msg };
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const rpcArgs = direction === "sell"
      ? { p_market_id: marketId, p_branch_id: branchCtx.branch.id, p_side: side, p_shares_to_sell: amount }
      : { p_market_id: marketId, p_branch_id: branchCtx.branch.id, p_side: side, p_amount: amount };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any).rpc("execute_branch_trade", rpcArgs);

    if (err) {
      Sentry.captureMessage("Branch trade execution failed", {
        level: "error",
        extra: {
          marketId,
          branchId: branchCtx.branch.id,
          side,
          direction,
          amount,
          errorMessage: err.message,
          errorCode: err.code,
        },
        tags: { source: "hook/branch-trade" },
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

  return { executeBranchTrade, loading, error, result, reset };
}
