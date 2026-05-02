import type { AgentLevel, Side } from "./database";

export interface AgentNetworkUserFlat {
  id: string;
  display_name: string | null;
  agent_level: AgentLevel;
  referral_count: number;
  referred_by: string;
}

export interface AgentNetworkFlat {
  l1_users: AgentNetworkUserFlat[];
  l2_users: AgentNetworkUserFlat[];
  commissions: Record<string, {
    commission_earned: number;
    revenue_generated: number;
    trade_count: number;
  }>;
}

export interface AgentNetworkNode {
  id: string;
  display_name: string | null;
  layer: 1 | 2;
  agent_level: AgentLevel;
  referral_count: number;
  commission_earned: number;
  revenue_generated: number;
  trade_count: number;
  children: AgentNetworkNode[];
}

export interface AgentDashboardStats {
  agent_balance_usd: number;
  total_credited: number;
  total_pending: number;
  total_escrowed: number;
  this_month_credited: number;
  network_size: number;
  network_volume: number;
  agent_level: AgentLevel;
  next_tier_volume: number;
  agent_activated: boolean;
  qualified_referral_count: number;
  activation_threshold: number;
}

export interface AgentCommissionFeedItem {
  id: string;
  trader_name: string;
  market_question: string;
  trade_side: Side | null;
  trade_amount: number | null;
  platform_revenue: number;
  commission_amount: number;
  layer: 1 | 2;
  revenue_type: "trade" | "resolution";
  status: "credited" | "escrowed";
  created_at: string;
  /** ISO 8601 UTC timestamp. NULL = instantly available. When set and in the future, the commission is pending (locked). */
  unlock_at?: string | null;
}

/**
 * Wallet summary returned by `get_agent_wallet_summary` RPC.
 * Splits agent wallet into available (transferable now) vs pending (locked).
 * See migration 250.
 */
export interface AgentWalletSummary {
  /** agent_balance_usd cache — total in the wallet */
  total: number;
  /** Transferable now: total − pending */
  available: number;
  /** Locked: sum of credited commissions with unlock_at > NOW() */
  pending: number;
  /** Earliest unlock_at of any pending row, or NULL if nothing pending. */
  next_unlock_at: string | null;
}
