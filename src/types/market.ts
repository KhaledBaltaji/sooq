import type { Database, Side, MarketStatus, TradeDirection, AlertDirection } from "./database";

// Core table types
export type Market = Database["public"]["Tables"]["markets"]["Row"];
export type Trade = Database["public"]["Tables"]["trades"]["Row"];
export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type AmmState = Database["public"]["Tables"]["amm_state"]["Row"];
export type PriceAlert = Database["public"]["Tables"]["price_alerts"]["Row"];
export type LeaderStats = Database["public"]["Tables"]["leader_stats"]["Row"];

// Market time state (unchanged from V2)
export type MarketTimeState = "upcoming" | "open" | "closing_soon" | "closed" | "resolved" | "voided";

// Market with AMM state attached (for list views)
export interface MarketWithAmm extends Market {
  amm_state?: AmmState | null;
}

// Trade with market info (for portfolio/history)
export interface TradeWithMarket extends Trade {
  market: Market;
}

// Position with market + AMM (for portfolio)
export interface PositionWithMarket extends Position {
  market: Market;
  amm_state: AmmState | null;
}

// RPC result types
export interface ExecuteTradeResult {
  trade_id: string;
  shares: number;
  price_per_share: number;
  total_cost: number;
  fee: number;
  new_yes_price: number;
  new_no_price: number;
  price_impact_warning: boolean;
}

export interface ClosePositionResult {
  gross_proceeds: number;
  explicit_fee: number;
  cash_out_premium: number;
  net_proceeds: number;
  price_per_share: number;
}

export interface AmmPriceResult {
  yes_price: number;
  no_price: number;
  volume: number;
  trades: number;
}

export type { Side, MarketStatus, TradeDirection, AlertDirection };
