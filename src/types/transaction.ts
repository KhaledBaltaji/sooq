// Transaction + money-flow types — standalone post-W2/W3/W4 strip.
// LMSR + commission types removed; speed-aware types added.

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "speed_stake"
  | "speed_cashout"
  | "speed_payout"
  | "speed_refund"
  | "admin_credit"
  | "admin_debit";

export type WithdrawalStatus = "pending" | "approved" | "rejected" | "sent";

export type DepositStatus = "pending" | "verified" | "rejected" | "expired";

// Note: numeric fields typed as `number` to match what supabase-js returns
// today. Postgres NUMERIC over the wire is technically a string; W7 service
// migration replaces supabase-js with Drizzle and these will get tightened
// to `string` to match `pg` driver behavior.

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  description: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface Deposit {
  id: string;
  user_id: string;
  provider: string;
  provider_ref: string;
  amount: number;
  currency: string;
  status: DepositStatus;
  proof_url: string | null;
  raw_payload: unknown;
  created_at: string;
  verified_at: string | null;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  account_details: unknown;
  status: WithdrawalStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface TransactionWithDetails extends Transaction {
  market_question?: string;
}
