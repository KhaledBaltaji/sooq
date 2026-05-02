import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPLICIT_FEE_RATE,
  CLOSE_POSITION_FEE_RATE,
  RESOLUTION_FEE_RATE,
} from "@/lib/constants";

export interface FeeRates {
  /** Explicit trading fee, charged on buy amount and sell gross proceeds. */
  explicit: number;
  /** Cash-out premium, charged on sell gross proceeds. */
  cashOut: number;
  /** Resolution fee, deducted from winning-share payout. */
  resolution: number;
}

export const DEFAULT_FEE_RATES: FeeRates = {
  explicit: EXPLICIT_FEE_RATE,
  cashOut: CLOSE_POSITION_FEE_RATE,
  resolution: RESOLUTION_FEE_RATE,
};

const FEE_TYPES = ["explicit_fee", "cash_out_premium", "resolution_fee"] as const;

export async function fetchFeeRates(supabase: SupabaseClient): Promise<FeeRates> {
  const { data, error } = await supabase
    .from("fee_config")
    .select("fee_type,rate")
    .in("fee_type", FEE_TYPES as unknown as string[]);

  if (error) throw error;

  const byType = new Map<string, number>();
  for (const row of data ?? []) {
    byType.set(row.fee_type, Number(row.rate));
  }

  return {
    explicit: byType.get("explicit_fee") ?? DEFAULT_FEE_RATES.explicit,
    cashOut: byType.get("cash_out_premium") ?? DEFAULT_FEE_RATES.cashOut,
    resolution: byType.get("resolution_fee") ?? DEFAULT_FEE_RATES.resolution,
  };
}
