"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";
import type { ClosePositionResult, ExecuteTradeResult } from "@/types/market";

export function useClosePosition() {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ClosePositionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = async (marketId: string, side: string, shares: number) => {
    setLoading(true);
    setError(null);

    // Demo has no fees → compute a simple preview off the demo AMM state
    // without calling the live get_cash_out_value RPC (which reads live tables).
    if (isDemo) {
      const ammTable = "demo_amm_state";
      const { data: amm, error: aErr } = await supabase
        .from(ammTable as never)
        .select("current_yes_price,current_no_price,liquidity_param,q_yes,q_no")
        .eq("market_id", marketId)
        .single();

      if (aErr || !amm) {
        setError(aErr?.message ?? "AMM state not found");
        setLoading(false);
        return null;
      }

      const a = amm as unknown as { current_yes_price: number; current_no_price: number };
      const pricePerShare = side === "yes" ? a.current_yes_price : a.current_no_price;
      const gross = pricePerShare * shares;
      const result: ClosePositionResult = {
        gross_value: gross,
        cash_out_premium: 0,
        net_value: gross,
        price_per_share: pricePerShare,
      } as unknown as ClosePositionResult;
      setPreviewData(result);
      setLoading(false);
      return result;
    }

    const { data, error: err } = await supabase.rpc("get_cash_out_value", {
      p_market_id: marketId,
      p_side: side,
      p_shares: shares,
    });

    if (err) {
      Sentry.captureMessage("Close position preview failed", {
        level: "error",
        extra: { marketId, side, shares, errorMessage: err.message },
        tags: { source: "hook/close-position" },
      });
      setError(err.message);
      setLoading(false);
      return null;
    }

    const result = data as unknown as ClosePositionResult;
    setPreviewData(result);
    setLoading(false);
    return result;
  };

  const execute = async (marketId: string, side: string, shares: number) => {
    setLoading(true);
    setError(null);

    const rpcName = isDemo ? "demo_execute_trade" : "execute_trade";
    const { data, error: err } = await supabase.rpc(rpcName as never, {
      p_market_id: marketId,
      p_side: side,
      p_shares_to_sell: shares,
    } as never);

    if (err) {
      Sentry.captureMessage("Close position execution failed", {
        level: "error",
        extra: { marketId, side, shares, demo: isDemo, errorMessage: err.message },
        tags: { source: "hook/close-position", demo: String(isDemo) },
      });
      setError(err.message);
      setLoading(false);
      return { data: null, error: err.message };
    }

    const result = data as unknown as ExecuteTradeResult;
    setLoading(false);
    return { data: result, error: null };
  };

  const reset = () => {
    setPreviewData(null);
    setError(null);
  };

  return { preview, execute, previewData, loading, error, reset };
}
