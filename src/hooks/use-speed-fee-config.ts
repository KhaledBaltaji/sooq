"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  fetchSpeedFeeConfig,
  DEFAULT_SPEED_FEE_CONFIG,
  type SpeedFeeConfig,
} from "@/lib/query/speed-fees/queries";

/**
 * Live speed-market fee config sourced from /api/fees + /api/speed/volatility.
 * Falls back to defaults that match the v1 seed, so the UI never shows NaN
 * before the first fetch.
 */
export function useSpeedFeeConfig(): SpeedFeeConfig {
  const { data } = useQuery({
    queryKey: queryKeys.speedFees.config(),
    queryFn: () => fetchSpeedFeeConfig(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return data ?? DEFAULT_SPEED_FEE_CONFIG;
}
