import type { AgentLevel } from "@/types/database";

// V3 AMM Constants

export const TRADE_PRESETS = [5, 10, 50, 100] as const;
export const DEPOSIT_PRESETS = [20, 50, 100, 200] as const;

export const MIN_TRADE = 5;

// 1 lot = 1000 shares (CFD-style display unit)
export const SHARES_PER_LOT = 1000;

// Minimum shares to display a position (below this = dust from floating-point)
export const MIN_DISPLAY_SHARES = 0.001;
export const MIN_DEPOSIT = 5;
export const MIN_WITHDRAWAL = 10;

export const DEPOSIT_BONUS_AMOUNT = 5;
export const DEPOSIT_BONUS_MIN_DEPOSIT = 20;
export const DEPOSIT_BONUS_WAGERING_MULTIPLIER = 2;

// Display-only fee defaults — actual rates come from fee_config table
export const EXPLICIT_FEE_RATE = 0.005; // 0.5%
export const RESOLUTION_FEE_RATE = 0.01; // 1%
export const CLOSE_POSITION_FEE_RATE = 0.005; // 0.5%

// NGR model: volume-based tier advancement thresholds (USD)
export const AGENT_VOLUME_THRESHOLDS: Record<AgentLevel, number> = {
  1: 0,
  2: 10_000,
  3: 50_000,
  4: 200_000,
};

export const MAX_REFERRAL_DEPTH = 2;

// Agent activation: qualified referrals needed before commissions flow
export const AGENT_ACTIVATION_THRESHOLD = 5;

// NGR commission rates by tier (display-only — actual rates from fee_config)
export const NGR_COMMISSION_RATES: Record<AgentLevel, { l1: number; l2: number }> = {
  1: { l1: 30, l2: 5 },
  2: { l1: 35, l2: 8 },
  3: { l1: 40, l2: 10 },
  4: { l1: 50, l2: 12 },
};

// AMM parameters (display-only defaults — actual from fee_config)
export const MAX_TRADE_PCT_OF_LIQUIDITY = 0.05; // 5% of b

// Dead market threshold
export const DEAD_MARKET_MIN_VOLUME = 100;
export const DEAD_MARKET_HOURS = 48;

// Activity feed
export const ACTIVITY_FEED_THROTTLE_MS = 1000;
export const ACTIVITY_FEED_MAX_ITEMS = 20;

// Withdrawal delay
export const WITHDRAWAL_DELAY_HOURS = 24;

// Closing soon threshold
export const CLOSING_SOON_HOURS = 2;

// Whish Manual Deposit — phone numbers users can send money to
export const WHISH_DEPOSIT_NUMBERS = [
  { label: "Whish 1", number: "+96176444504" },
  { label: "Whish 2", number: "+96103444716" },
  { label: "Whish 3", number: "+96176016531" },
] as const;
