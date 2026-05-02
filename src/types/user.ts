import type { Database, AgentLevel } from "./database";

export type User = Database["public"]["Tables"]["users"]["Row"];

export interface UserProfile {
  id: string;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  balance_usd: number;
  referral_code: string;
  referred_by: string | null;
  agent_level: AgentLevel;
  direct_referral_count: number;
  locale: string;
  is_admin: boolean;
  admin_allowed_views: string[] | null;
  // Demo Mode (migration 263)
  demo_mode: boolean;
  demo_balance_usd: number;
  demo_first_enabled_at: string | null;
  demo_first_trade_at: string | null;
  first_real_deposit_after_demo_at: string | null;
}

export interface AgentStats {
  level: AgentLevel;
  direct_referral_count: number;
  tier1_earnings: number;
  tier2_earnings: number;
  tier3_earnings: number;
  total_earnings: number;
}

export type { AgentLevel };
