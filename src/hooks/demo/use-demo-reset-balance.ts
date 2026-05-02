"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "@/components/providers/supabase-provider";

export interface DemoResetResult {
  demo_balance_usd: number;
  delta: number;
}

/**
 * Resets the user's demo balance to $10,000. Open positions are preserved.
 */
export function useDemoResetBalance() {
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase.rpc("demo_reset_balance" as never, {} as never);

    if (err) {
      Sentry.captureMessage("Demo balance reset failed", {
        level: "warning",
        extra: { errorMessage: err.message },
        tags: { source: "hook/demo-reset-balance" },
      });
      setError(err.message);
      setLoading(false);
      return { data: null, error: err.message };
    }

    setLoading(false);
    return { data: data as unknown as DemoResetResult, error: null };
  };

  return { reset, loading, error };
}
