-- 0018_oracle_mid_pricing.sql
--
-- Group C (chart smoothness): oracle worker switched from `btcusdt@trade`
-- to `btcusdt@bookTicker`. The price column on speed_oracle_ticks /
-- speed_oracle_latest now stores the top-of-book MID = (bid + ask) / 2,
-- not the last-trade price.
--
-- Why: @trade alternates buyer-/seller-initiated prints, so consecutive
-- prices zigzag by spread amount ($0.01–$0.10 on BTCUSDT). That sawtooth
-- showed up on the chart as visible "bouncing" even on calm markets.
-- Mid is monotonically driven by real flow, doesn't alternate, and is
-- the standard reference price for derivatives.
--
-- Two effects on the wick detector:
--   * Mid is much quieter than @trade ticks. The 0.003 threshold from
--     0017 was tuned to absorb @trade noise; with mid we can put it
--     back to 0.0015 (0.15%) for tighter manipulation defense without
--     false positives during normal volatility.
--   * Settlement and pricing RPCs are unchanged — they read price from
--     speed_oracle_latest the same way; only the source semantics are
--     better.

-- Tighten the wick threshold (less noise tolerance is OK with mid pricing).
UPDATE public.fee_config
   SET rate = 0.0015,
       description = '0018: settlement wick detector. If 5s price delta exceeds this %, fall back to median-of-30-ticks. Tightened 0.003 -> 0.0015 in 0018 because oracle now writes bookTicker mid (much quieter than @trade). Set to 0 to disable.',
       updated_at = NOW()
 WHERE fee_type = 'speed_wick_threshold_pct';

-- Document the price-column semantics change so anyone reading the
-- schema downstream knows what the number actually represents.
COMMENT ON COLUMN public.speed_oracle_ticks.price IS
  'Reference price observed at `ts`. As of mig 0018, this is the Binance top-of-book mid = (best_bid + best_ask) / 2 (was last-trade price pre-0018). Single source for chart, execution freshness gate, and wick-detector settlement.';

COMMENT ON COLUMN public.speed_oracle_latest.price IS
  'Most recent reference price for the asset. As of mig 0018, this is the Binance top-of-book mid = (best_bid + best_ask) / 2 (was last-trade price pre-0018).';
