import type { Database, TransactionType, WithdrawalStatus, CommissionStatus } from "./database";

export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type Deposit = Database["public"]["Tables"]["deposits"]["Row"];
export type Withdrawal = Database["public"]["Tables"]["withdrawals"]["Row"];
export type ReferralCommission = Database["public"]["Tables"]["referral_commissions"]["Row"];

export interface TransactionWithDetails extends Transaction {
  market_question?: string;
}

export type { TransactionType, WithdrawalStatus, CommissionStatus };
