"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/components/providers/supabase-provider";
import { queryKeys } from "@/lib/query/keys";
import {
  fetchSpeedFeeConfig,
  DEFAULT_SPEED_FEE_CONFIG,
  type SpeedFeeConfig,
} from "@/lib/query/speed-fees/queries";

/**
 * Live speed-market fee config from `fee_config` (rows `speed_*`):
 * IV per asset, spread, handle fee, cashout multipliers. Falls back to
 * defaults that match mig 317 seeds, so the UI never shows NaN before the
 * first fetch. Admin edits propagate via React Query invalidation.
 */
export function useSpeedFeeConfig(): SpeedFeeConfig {
  const supabase = useSupabase();
  const { data } = useQuery({
    queryKey: queryKeys.speedFees.config(),
    queryFn: () => fetchSpeedFeeConfig(supabase),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return data ?? DEFAULT_SPEED_FEE_CONFIG;
}
