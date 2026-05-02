// Slim type shim post-W2/W3/W4 strip.
// Original auto-generated Supabase Database type was full of LMSR / branch /
// commission / demo / prelaunch tables that no longer exist. Until W7 cuts
// the supabase-js client over to Drizzle, this file exposes just the speed
// types the components import.
//
// W7 service migration: replace these with `typeof speedX.$inferSelect` from
// `@/lib/db/schema.ts` and delete this file.

// ---- Speed enums ----
// SpeedDuration kept permissive because some legacy code paths reference
// "1h" (dropped in mig 361). Tightening to the live enum is W7 cleanup.
export type SpeedAsset = "BTC";
export type SpeedDuration = "5m" | "15m" | "1h" | "24h";
export type SpeedSide = "over" | "under";
// SpeedMarketStatus permissive ('pending' / 'halted' from older code paths).
export type SpeedMarketStatus =
  | "open"
  | "resolving"
  | "resolved"
  | "voided"
  | "pending"
  | "halted";
export type SpeedMarketOutcome = "over" | "under" | "at_strike";
export type SpeedPositionStatus =
  | "open"
  | "won"
  | "lost"
  | "cashed_out"
  | "refunded";
export type SpeedTradeKind = "open" | "cashout";

// LMSR side type kept as a stub for agent.ts and other surviving lib types.
// Never used by live code post-W2 strip.
export type Side = "yes" | "no";

// ---- Speed row shapes (snake_case to match supabase-js responses pre-W7) ----

export interface SpeedMarket {
  id: string;
  asset: SpeedAsset;
  duration: SpeedDuration;
  strike_price: string;
  settlement_price: string | null;
  opens_at: string;
  closes_at: string;
  status: SpeedMarketStatus;
  outcome: SpeedMarketOutcome | null;
  twap_at_close: string | null;
  void_reason: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpeedPosition {
  id: string;
  user_id: string;
  market_id: string;
  side: SpeedSide;
  stake: string;
  entry_price: string;
  entry_fair_prob: string;
  entry_offered_prob: string;
  status: SpeedPositionStatus;
  payout_amount: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface SpeedTrade {
  id: string;
  position_id: string;
  user_id: string;
  market_id: string;
  kind: SpeedTradeKind;
  amount: string;
  spot_price: string;
  fair_prob: string;
  offered_prob: string;
  handle_fee: string | null;
  cashout_multiplier: string | null;
  idempotency_key: string | null;
  created_at: string;
}

// ---- Speed RPC return shapes ----

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
  handle_fee: number;
  idempotent?: boolean;
  message?: string;
}

export interface SpeedExecuteCashoutResult {
  success: boolean;
  trade_id: string;
  cashout_amount: number;
  fair_value: number;
  fair_profit: number;
  role: "winner" | "loser";
  bucket: string;
  multiplier: number;
  pct_time_left: number;
  idempotent?: boolean;
  message?: string;
}

export interface SpeedOracleLatest {
  asset: SpeedAsset;
  source: string;
  price: string;
  ts: string;
  received_at: string;
}

// ---- Admin / misc types ----

export interface AdminSidebarCounts {
  pending_finance: number;
  [key: string]: number;
}

// Branch system stripped W3 — kept as type stub for future re-add.
export type AgentLevel = 1 | 2 | 3 | 4;

// LMSR stripped W2 — kept as type stub. Direction was 'buy' | 'sell' for trades.
export type TradeDirection = "buy" | "sell";

// ---- Database root (placeholder for the supabase-js client) ----
// supabase-js uses this to type query responses. We're not maintaining
// the full schema here — just give it a permissive shape so the client
// type-checks. W7 replaces supabase-js with Drizzle and this can go.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
