// W7 cutover: types here mirror the JSON returned by the new /api/* routes.
// snake_case to match the API boundary; numbers stay numbers (the API
// converts NUMERIC columns to JS numbers for us).
//
// `Database` placeholder kept so the few remaining typed `db` references
// type-check until they're cut over to Drizzle proper.

// ---- Speed enums ----
export type SpeedAsset = "BTC";
export type SpeedDuration = "5m" | "1h";
export type SpeedSide = "over" | "under";
export type SpeedMarketStatus = "open" | "resolving" | "resolved" | "voided";
export type SpeedMarketOutcome = "over" | "under" | "at_strike";
export type SpeedPositionStatus =
  | "open"
  | "won"
  | "lost"
  | "cashed_out"
  | "refunded";
export type SpeedTradeKind = "open" | "cashout";

// LMSR side type kept as a stub for legacy lib types.
export type Side = "yes" | "no";

// ---- Speed row shapes (snake_case from /api/speed/*) ----

export interface SpeedMarket {
  id: string;
  asset: SpeedAsset;
  duration: SpeedDuration;
  strike_price: number | null;
  opens_at: string;
  closes_at: string;
  status: SpeedMarketStatus;
  outcome: SpeedMarketOutcome | null;
  twap_at_close: number | null;
  void_reason: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface SpeedPosition {
  id: string;
  user_id: string;
  market_id: string;
  side: SpeedSide;
  stake: number;
  entry_price: number;
  entry_fair_prob: number;
  entry_offered_prob: number;
  status: SpeedPositionStatus;
  payout_amount: number | null;
  closed_at: string | null;
  created_at: string;
}

export interface SpeedTrade {
  id: string;
  position_id: string;
  user_id: string;
  market_id: string;
  kind: SpeedTradeKind;
  amount: number;
  spot_price: number;
  fair_prob: number;
  offered_prob: number;
  handle_fee: number | null;
  cashout_multiplier: number | null;
  idempotency_key: string | null;
  created_at: string;
}

// ---- RPC return shapes (jsonb) ----

export interface SpeedExecuteTradeResult {
  success: boolean;
  position_id: string;
  trade_id: string;
  side: SpeedSide;
  stake: number;
  spot_price: number;
  strike: number;
  fair_prob: number;
  offered_prob: number;
  payout_if_won: number;
  // Mig 369: handle_fee removed from RPC return shape (phantom field deleted).
  iv_used?: number;
  late_window_pct?: number;
  idempotent?: boolean;
  message?: string;
}

// Mig 369: continuous formula — no winner/loser branch, no buckets.
//   cashout = stake × (mark_prob / entry_offered) × decay × liq_discount
export interface SpeedExecuteCashoutResult {
  success: boolean;
  trade_id: string;
  cashout_amount: number;
  mark_prob: number;
  decay: number;
  liq_discount: number;
  iv_used: number;
  pct_time_left: number;
  idempotent?: boolean;
  message?: string;
}

export interface SpeedOracleLatest {
  asset: SpeedAsset;
  price: number;
  received_at: string;
}

// ---- Admin / misc types ----

export interface AdminSidebarCounts {
  pending_finance: number;
  pending_deposits?: number;
  pending_withdrawals?: number;
}

// Branch system stripped W3 — kept as type stub for future re-add.
export type AgentLevel = 1 | 2 | 3 | 4;

// LMSR stripped W2 — kept as type stub. Direction was 'buy' | 'sell'.
export type TradeDirection = "buy" | "sell";

// ---- Database root placeholder ----
// Pre-W7 the supabase-js client used this. Post-W7 only used as a name in
// a couple of orphaned imports until those files are deleted in Phase E.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
