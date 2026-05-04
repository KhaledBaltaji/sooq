-- 0017_wick_threshold_tune.sql
--
-- Group B (CFD-feel migration): the oracle worker now writes to
-- speed_oracle_ticks at ~10 Hz (was ~1 Hz, when subscribed to
-- @kline_1s). With the higher-frequency raw Binance trade feed, the
-- 5s-before-close vs exact-close price delta naturally has more
-- microstructure noise. The 0.001 (0.1%) wick threshold from mig 0016
-- starts firing on legitimate volatility instead of just manipulation.
--
-- Bumping to 0.003 (0.3%) — anything less is normal market movement we
-- want to settle on, anything more is sharp manipulation we want to
-- catch via the median-of-30-ticks fallback.
--
-- Tunable post-deploy via fee_config update — no code change needed
-- if we want to re-tune later based on observed false-positive rate.

UPDATE public.fee_config
   SET rate = 0.003,
       description = '0017: settlement wick detector. If 5s price delta exceeds this %, fall back to median-of-30-ticks. Bumped 0.001 -> 0.003 in 0017 for 10 Hz @trade feed (was tuned for 1 Hz @kline_1s in 0016). Set to 0 to disable.',
       updated_at = NOW()
 WHERE fee_type = 'speed_wick_threshold_pct';
