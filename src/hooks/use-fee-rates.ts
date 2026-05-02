"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/components/providers/supabase-provider";
import { queryKeys } from "@/lib/query/keys";
import {
  fetchFeeRates,
  DEFAULT_FEE_RATES,
  type FeeRates,
} from "@/lib/query/fees/queries";

/**
 * Live fee rates from `fee_config`. Falls back to hardcoded defaults until the
 * fetch resolves, so the UI never shows NaN. Admin edits via
 * `admin_update_fee` propagate here via React Query invalidation (or the 5min
 * staleTime, whichever comes first).
 */
export function useFeeRates(): FeeRates {
  const supabase = useSupabase();
  const { data } = useQuery({
    queryKey: queryKeys.fees.rates(),
    queryFn: () => fetchFeeRates(supabase),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return data ?? DEFAULT_FEE_RATES;
}
