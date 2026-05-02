import type { Database } from "./database";
import type { Market } from "./market";

export type FeeConfig = Database["public"]["Tables"]["fee_config"]["Row"];
export type PlatformRevenue = Database["public"]["Tables"]["platform_revenue"]["Row"];

export interface AdminMarketView extends Market {
  total_trades: number;
  total_volume: number;
  unique_traders: number;
  both_side_traders: number;
}

export interface TreasuryOverview {
  total_deposits: number;
  total_withdrawals: number;
  total_platform_fees: number;
  total_commissions_paid: number;
  net_revenue: number;
  active_balance: number;
}

export interface AlertItem {
  id: string;
  type: "lopsided_market" | "large_trade" | "multi_account" | "dead_market" | "both_side_trading";
  severity: "low" | "medium" | "high";
  message: string;
  reference_id: string;
  created_at: string;
  is_resolved: boolean;
}
