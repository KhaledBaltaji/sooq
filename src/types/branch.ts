// Branch table row types — standalone (database.ts will be regenerated to include these later)
// For now, these are manually defined to avoid breaking existing type exports.

// TODO: After full database.ts regeneration + backward-compat fix, switch these to:
// export type BranchRow = Database["public"]["Tables"]["branches"]["Row"];
// etc.

export type BranchStatus = "active" | "payback" | "frozen" | "suspended";
export type BranchDisplayMode = "trading" | "betting";
export type BranchBookType = "reseller" | "bookmaker" | "commission";

/** Public-facing branch data (safe to expose to client via context) */
export interface BranchPublic {
  id: string;
  name: string;
  branch_code: string;
  status: BranchStatus;
  display_mode: BranchDisplayMode;
  yes_markup_pct: number;
  no_markup_pct: number;
  exit_fee_pct: number;
  cash_out_enabled: boolean;
  book_type?: BranchBookType;
}

export interface BranchSolvency {
  pool_balance: number;
  worst_case_total: number;
  pending_payouts: number;
  utilization: number;
  status: "green" | "yellow" | "red";
  can_trade: boolean;
  withdrawal_available: number;
  branch_status: BranchStatus;
}

/**
 * Shape returned by `branch_dashboard_stats` RPC.
 *
 * book_type='reseller' returns pool/volume stats.
 * book_type='commission' returns commission earnings + attributed users.
 * Callers must check `book_type` and narrow accordingly.
 */
export interface BranchDashboardStatsReseller {
  book_type: "reseller";
  user_count: number;
  active_agent_count: number;
  trade_count: number;
  total_volume: number;
  total_revenue: number;
  trades_last_24h: number;
  active_markets: number;
}

export interface BranchDashboardStatsCommission {
  book_type: "commission";
  user_count: number;
  active_agent_count: number;
  commission_credited: number;
  commission_escrowed: number;
  qualified_referral_count: number;
  network_volume: number;
  agent_level: number;
  agent_activated: boolean;
}

export type BranchDashboardStats =
  | BranchDashboardStatsReseller
  | BranchDashboardStatsCommission;

export interface BranchOverviewRow {
  id: string;
  name: string;
  branch_code: string;
  book_type: BranchBookType;
  status: BranchStatus;
  pool_balance: number;
  worst_case_total: number;
  pending_payouts: number;
  yes_markup_pct: number;
  no_markup_pct: number;
  branch_fee_rate: number;
  display_mode: string;
  cash_out_enabled: boolean;
  payback_activated_at: string | null;
  created_at: string;
  updated_at: string;
  manager_name: string | null;
  manager_phone: string | null;
  manager_user_id: string;
  user_count: number;
  active_agent_count: number;
  trade_count: number;
  total_volume: number;
  total_revenue: number;
  utilization_pct: number;
}

export const BRANCH_BOOK_TYPE_CONFIG: Record<BranchBookType, { label: string; badgeClass: string }> = {
  reseller: { label: "Reseller", badgeClass: "bg-blue-100 text-blue-700" },
  bookmaker: { label: "Bookmaker", badgeClass: "bg-amber-100 text-amber-700" },
  commission: { label: "Commission", badgeClass: "bg-indigo-100 text-indigo-700" },
};

export const BRANCH_STATUS_CONFIG: Record<BranchStatus, { label: string; dotClass: string; textClass: string }> = {
  active: { label: "ACTIVE", dotClass: "bg-emerald-500 animate-pulse", textClass: "text-emerald-600" },
  payback: { label: "PAYBACK", dotClass: "bg-amber-500 animate-pulse", textClass: "text-amber-600" },
  frozen: { label: "FROZEN", dotClass: "bg-blue-400", textClass: "text-blue-500" },
  suspended: { label: "SUSPENDED", dotClass: "bg-[var(--error)]", textClass: "text-[var(--error)]" },
};

export const SOLVENCY_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  green: { label: "Healthy", color: "text-emerald-600", bgColor: "bg-emerald-100" },
  yellow: { label: "Warning", color: "text-amber-600", bgColor: "bg-amber-100" },
  red: { label: "Critical", color: "text-red-600", bgColor: "bg-red-100" },
};
