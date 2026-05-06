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

// Mig 0028+: pricing engine v2.
// Mig 0030+: adds seconds_left_bucket for parity gating.
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
  // Mig 0028: spread multiplier applied at trade open (1.0 / 1.4 / 1.8 by
  // late-window). Always present; 1.0 outside late window.
  spread_mult: number;
  // Mig 0030: 0=60s+, 1=30-60s, 2=10-30s, 3=<10s (rejected at execute).
  seconds_left_bucket: number;
  // Mig 0029: IV used at execute time (from speed_volatility_cache helper).
  iv_used: number;
  idempotent?: boolean;
  message?: string;
}

// Mig 0028+: profit-based margin (option C). Direction-matching invariant
// enforced algebraically: mark_prob > entry_offered_prob ⇒ cashout > stake.
//   fair_profit = stake × (mark_prob/entry_offered_prob − 1)
//   winning side  cashout = stake + fair_profit × (1 − margin_winning)
//   losing side   cashout = stake + fair_profit × (1 + margin_losing)
//   margin = base + saturation/desperation premium + late_window premium
// Mig 0030+: adds seconds_left_bucket for parity gating.
export interface SpeedExecuteCashoutResult {
  success: boolean;
  trade_id: string;
  position_id: string;
  cashout_amount: number;
  mark_prob: number;
  // Mig 0028: true if user is winning at mark (mark_prob >= entry_offered_prob).
  is_winning: boolean;
  // Mig 0028: total margin applied (base + premium tiers).
  margin_applied: number;
  // Mig 0028: profit at fair value before margin (signed; positive = winning).
  fair_profit: number;
  iv_used: number;
  pct_time_left: number;
  // Mig 0030: 0=60s+, 1=30-60s, 2=10-30s, 3=<10s (rejected at execute).
  seconds_left_bucket: number;
  idempotent?: boolean;
  message?: string;
}

export interface SpeedOracleLatest {
  asset: SpeedAsset;
  price: number;
  received_at: string;
  /**
   * Server-computed age in milliseconds at the moment of the API response.
   * Present when sourced from /api/speed/oracle (post-hotfix). Absent
   * when the row is synthesized client-side from the Binance WS feed
   * (those use device-local timestamps and don't need it).
   */
  age_ms?: number;
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
