// W7 cutover: Drizzle/RDS-backed via /api/fees.

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
  /** Withdrawal fee charged on amount. */
  withdrawal: number;
  /** Deposit fee charged on incoming deposits. */
  deposit: number;
}

export const DEFAULT_FEE_RATES: FeeRates = {
  explicit: EXPLICIT_FEE_RATE,
  cashOut: CLOSE_POSITION_FEE_RATE,
  resolution: RESOLUTION_FEE_RATE,
  withdrawal: 0.01,
  deposit: 0,
};

interface FeesResponse {
  fees: Array<{ fee_type: string; rate: number; description: string | null }>;
}

export async function fetchFeeRates(): Promise<FeeRates> {
  const res = await fetch("/api/fees");
  if (!res.ok) throw new Error(`Failed to load fees (${res.status})`);
  const json: FeesResponse = await res.json();

  const byType = new Map<string, number>();
  for (const row of json.fees ?? []) {
    byType.set(row.fee_type, Number(row.rate));
  }

  return {
    explicit: byType.get("explicit_fee") ?? DEFAULT_FEE_RATES.explicit,
    cashOut: byType.get("cash_out_premium") ?? DEFAULT_FEE_RATES.cashOut,
    resolution: byType.get("resolution_fee") ?? DEFAULT_FEE_RATES.resolution,
    withdrawal: byType.get("withdrawal_fee") ?? DEFAULT_FEE_RATES.withdrawal,
    deposit: byType.get("deposit_fee") ?? DEFAULT_FEE_RATES.deposit,
  };
}
